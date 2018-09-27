import { CheckoutButtonInitializeOptions, CheckoutButtonOptions } from '../';
import { Checkout, CheckoutActionCreator, CheckoutStore } from '../../checkout';
import {
    InvalidArgumentError,
    MissingDataError,
    MissingDataErrorType
} from '../../common/error/errors';
import { PaymentMethod, PaymentMethodActionCreator } from '../../payment';
import {
    Masterpass,
    MasterpassCheckoutOptions,
    MasterpassScriptLoader
} from '../../payment/strategies/masterpass';

import { CheckoutButtonStrategy, MasterpassButtonInitializeOptions } from './';

export default class MasterpassButtonStrategy extends CheckoutButtonStrategy {
    private _signInButton?: HTMLElement;
    private _paymentMethod?: PaymentMethod;
    private _checkout?: Checkout;

    constructor(
        private _store: CheckoutStore,
        private _checkoutActionCreator: CheckoutActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _masterpassScriptLoader: MasterpassScriptLoader
    ) {
        super();
    }

    initialize(options: CheckoutButtonInitializeOptions): Promise<void> {
        const { masterpass: masterpassOptions, methodId } = options;

        if (!masterpassOptions || !methodId) {
            throw new InvalidArgumentError('Unable to proceed because "options.masterpass" argument is not provided.');
        }

        if (this._isInitialized) {
            return super.initialize(options);
        }

        return Promise.all(
            [
                this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId)),
                this._store.dispatch(this._checkoutActionCreator.loadDefaultCheckout()),
            ]
        ).then(([statePayment, stateCheckout]) => {
                this._paymentMethod = statePayment.paymentMethods.getPaymentMethod(methodId);
                if (!this._paymentMethod || !this._paymentMethod.initializationData.checkoutId) {
                    throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                }

                this._checkout = stateCheckout.checkout.getCheckout();
                if (!this._checkout || !this._checkout.cart.id) {
                    throw new MissingDataError(MissingDataErrorType.MissingCart);
                }

                const payload = this._createMasterpassPayload(this._paymentMethod, this._checkout);

                return this._masterpassScriptLoader.load(this._paymentMethod.config.testMode)
                    .then(Masterpass => {
                        this._createSignInButton(masterpassOptions, Masterpass, payload);
                    });
        })
        .then(() => super.initialize(options));
    }

    deinitialize(options: CheckoutButtonOptions): Promise<void> {
        if (!this._isInitialized) {
            return super.deinitialize(options);
        }

        this._paymentMethod = undefined;
        this._checkout = undefined;

        if (this._signInButton && this._signInButton.parentNode) {
            this._signInButton.parentNode.removeChild(this._signInButton);
            this._signInButton = undefined;
        }

        return super.deinitialize(options);
    }

    private _createSignInButton(masterpassOptions: MasterpassButtonInitializeOptions, masterpass: Masterpass, payload: MasterpassCheckoutOptions): void {
        const { container } = masterpassOptions;
        const buttoncontainer = document.querySelector(`#${container}`);

        if (!buttoncontainer) {
            throw new Error('Need a container to place the button');
        }

        const button = document.createElement('input');

        button.type = 'image';
        button.src = 'https://static.masterpass.com/dyn/img/btn/global/mp_chk_btn_160x037px.svg';
        buttoncontainer.appendChild(button);
        this._signInButton = button;
        this._signInButton.addEventListener('click', () => {
            masterpass.checkout(payload);
        });
    }

    private _createMasterpassPayload(paymentMethod: PaymentMethod, checkout: Checkout): MasterpassCheckoutOptions {
        return {
            checkoutId: paymentMethod.initializationData.checkoutId,
            allowedCardTypes: paymentMethod.initializationData.allowedCardTypes,
            amount: checkout.cart.cartAmount.toString(),
            currency: checkout.cart.currency.code,
            cartId: checkout.cart.id,
            suppressShippingAddress: true,
        };
    }
}
