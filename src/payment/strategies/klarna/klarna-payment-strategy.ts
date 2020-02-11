import { includes } from 'lodash';

import { Address } from '../../../address';
import { BillingAddress } from '../../../billing';
import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType, NotInitializedError, NotInitializedErrorType } from '../../../common/error/errors';
import { OrderActionCreator, OrderRequestBody } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { RemoteCheckoutActionCreator } from '../../../remote-checkout';
import { PaymentMethodCancelledError, PaymentMethodInvalidError } from '../../errors';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategy from '../payment-strategy';

import KlarnaCredit, { KlarnaAddress, KlarnaLoadResponse, KlarnaUpdateSessionParams } from './klarna-credit';
import KlarnaPayments, { KlarnaAuthorizationResponse } from './klarna-payments';
import KlarnaScriptLoader from './klarna-script-loader';

export default class KlarnaPaymentStrategy implements PaymentStrategy {
    private _klarnaCredit?: KlarnaCredit;
    private _klarnaPayments?: KlarnaPayments;
    private _unsubscribe?: (() => void);
    private _supportedEUCountries = ['AT', 'DE', 'DK', 'FI', 'GB', 'NL', 'NO', 'SE', 'CH'];

    constructor(
        private _store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _remoteCheckoutActionCreator: RemoteCheckoutActionCreator,
        private _klarnaScriptLoader: KlarnaScriptLoader
    ) {}

    initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        const { klarnav2 } = options;

        if (klarnav2) {
            return this._initializeV2(options);
        }

        return this._klarnaScriptLoader.loadCredit()
            .then(klarnaCredit => { this._klarnaCredit = klarnaCredit; })
            .then(() => {
                this._unsubscribe = this._store.subscribe(
                    state => {
                        if (state.paymentStrategies.isInitialized(options.methodId)) {
                            this._loadWidget(options);
                        }
                    },
                    state => {
                        const checkout = state.checkout.getCheckout();

                        return checkout && checkout.outstandingBalance;
                    }
                );

                return this._loadWidget(options);
            })
            .then(() => this._store.getState());
    }

    deinitialize(): Promise<InternalCheckoutSelectors> {
        if (this._unsubscribe) {
            this._unsubscribe();
        }

        return Promise.resolve(this._store.getState());
    }

    execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!payload.payment) {
            throw new InvalidArgumentError('Unable to proceed because "payload.payment" argument is not provided.');
        }

        const { payment: { paymentData, ...paymentPayload } } = payload;

        return this._authorize(paymentPayload.methodId)
            .then(({ authorization_token: authorizationToken }) => this._store.dispatch(
                this._remoteCheckoutActionCreator.initializePayment('klarna', { authorizationToken })
            ))
            .then(() => this._store.dispatch(
                this._orderActionCreator.submitOrder({
                    ...payload,
                    payment: paymentPayload,
                    // Note: API currently doesn't support using Store Credit with Klarna.
                    // To prevent deducting customer's store credit, set it as false.
                    useStoreCredit: false,
                }, options)
            ));
    }

    finalize(): Promise<InternalCheckoutSelectors> {
        return Promise.reject(new OrderFinalizationNotRequiredError());
    }

    private _initializeV2(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        return this._klarnaScriptLoader.loadPayments()
            .then(klarnaPayments => { this._klarnaPayments = klarnaPayments; })
            .then(() => {
                this._unsubscribe = this._store.subscribe(
                    state => {
                        if (state.paymentStrategies.isInitialized(options.methodId)) {
                            this._loadPaymentsWidget(options);
                        }
                    },
                    state => {
                        const checkout = state.checkout.getCheckout();

                        return checkout && checkout.outstandingBalance;
                    }
                );

                return this._loadPaymentsWidget(options);
            })
            .then(() => this._store.getState());
    }

    private _loadWidget(options: PaymentInitializeOptions): Promise<KlarnaLoadResponse> {
        if (!options.klarna) {
            throw new InvalidArgumentError('Unable to load widget because "options.klarna" argument is not provided.');
        }

        const { methodId, klarna: { container, onLoad } } = options;

        return this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId))
            .then(state => new Promise<KlarnaLoadResponse>(resolve => {
                const paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

                if (!paymentMethod) {
                    throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                }

                if (!this._klarnaCredit || !paymentMethod.clientToken) {
                    throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                }

                this._klarnaCredit.init({ client_token: paymentMethod.clientToken });

                this._klarnaCredit.load({ container }, response => {
                    if (onLoad) {
                        onLoad(response);
                    }
                    resolve(response);
                });
            }));
    }

    private _loadPaymentsWidget(options: PaymentInitializeOptions): Promise<KlarnaLoadResponse> {
        if (!options.klarnav2) {
            throw new InvalidArgumentError('Unable to load widget because "options.klarna" argument is not provided.');
        }

        const { methodId, klarnav2: { container, payment_method_category, onLoad } } = options;
        const state = this._store.getState();

        return new Promise<KlarnaLoadResponse>(resolve => {
            const paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

            if (!paymentMethod) {
                throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
            }

            if (!this._klarnaPayments || !paymentMethod.clientToken) {
                throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
            }

            this._klarnaPayments.init({ client_token: paymentMethod.clientToken });
            this._klarnaPayments.load({ container, payment_method_category }, response => {
                if (onLoad) {
                    onLoad(response);
                }
                resolve(response);
            });
        });
    }

    private _getUpdateSessionData(billingAddress: BillingAddress, shippingAddress?: Address): KlarnaUpdateSessionParams {
        if (!includes(this._supportedEUCountries, billingAddress.countryCode)) {
            return {};
        }

        const data: KlarnaUpdateSessionParams = {
            billing_address: this._mapToKlarnaAddress(billingAddress, billingAddress.email),
        };

        if (shippingAddress) {
            data.shipping_address = this._mapToKlarnaAddress(shippingAddress, billingAddress.email);
        }

        return data;
    }

    private _mapToKlarnaAddress(address: Address, email?: string): KlarnaAddress {
        const klarnaAddress: KlarnaAddress = {
            street_address: address.address1,
            city: address.city,
            country: address.countryCode,
            given_name: address.firstName,
            family_name: address.lastName,
            postal_code: address.postalCode,
            region: address.stateOrProvince,
            email,
        };

        if (address.address2) {
            klarnaAddress.street_address2 = address.address2;
        }

        if (address.phone) {
            klarnaAddress.phone = address.phone;
        }

        return klarnaAddress;
    }

    private async _updateOrder() {
        await this._paymentMethodActionCreator.loadPaymentMethod('klarna').toPromise();
    }

    private _authorize(category: string): Promise<KlarnaAuthorizationResponse> {
        return new Promise<KlarnaAuthorizationResponse>((resolve, reject) => {
            const billingAddress = this._store.getState().billingAddress.getBillingAddress();
            const shippingAddress = this._store.getState().shippingAddress.getShippingAddress();

            if (!billingAddress) {
                throw new MissingDataError(MissingDataErrorType.MissingBillingAddress);
            }

            const updateSessionData = this._getUpdateSessionData(billingAddress, shippingAddress);

            if (category !== 'klarna') {
                this._updateOrder();

                if (!this._klarnaPayments) {
                    throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                }

                this._klarnaPayments.authorize({ payment_method_category: category }, updateSessionData, res => {
                    if (res.approved) {
                        return resolve(res);
                    }

                    if (res.show_form) {
                        return reject(new PaymentMethodCancelledError());
                    }

                    reject(new PaymentMethodInvalidError());
                });
            } else {
                if (!this._klarnaCredit) {
                    throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                }

                this._klarnaCredit.authorize(updateSessionData, res => {
                    if (res.approved) {
                        return resolve(res);
                    }

                    if (res.show_form) {
                        return reject(new PaymentMethodCancelledError());
                    }

                    reject(new PaymentMethodInvalidError());
                });
            }
        });
    }
}
