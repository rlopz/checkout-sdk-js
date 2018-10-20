import { CheckoutButtonInitializeOptions, CheckoutButtonOptions } from '../';
import { Checkout, CheckoutActionCreator, CheckoutStore } from '../../checkout';
import {
    InvalidArgumentError,
    MissingDataError,
    MissingDataErrorType
} from '../../common/error/errors';
import { bindDecorator as bind } from '../../common/utility';
import { PaymentMethod, PaymentMethodActionCreator } from '../../payment';
import {
    Masterpass,
    MasterpassCheckoutOptions,
    MasterpassScriptLoader
} from '../../payment/strategies/masterpass';

import { CheckoutButtonStrategy, MasterpassButtonInitializeOptions } from './';

export default class MasterpassButtonStrategy extends CheckoutButtonStrategy {
    private _masterpassClient?: Masterpass;
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

                return this._masterpassScriptLoader.load(this._paymentMethod.config.testMode)
                    .then(masterpass => {
                        this._masterpassClient = masterpass;
                        this._createSignInButton(masterpassOptions);
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
            this._signInButton.removeEventListener('click', this._handleWalletButtonClick);
            this._signInButton.parentNode.removeChild(this._signInButton);
            this._signInButton = undefined;
        }

        return super.deinitialize(options);
    }

    private _createSignInButton(masterpassOptions: MasterpassButtonInitializeOptions): void {
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
        this._signInButton.addEventListener('click', this._handleWalletButtonClick);
    }

    private _createMasterpassPayload(): MasterpassCheckoutOptions {
        return {
            checkoutId: this.paymentMethod.initializationData.checkoutId,
            allowedCardTypes: this.paymentMethod.initializationData.allowedCardTypes,
            amount: this.checkout.cart.cartAmount.toString(),
            currency: this.checkout.cart.currency.code,
            cartId: this.checkout.cart.id,
            suppressShippingAddress: true,
        };
    }

    @bind
    private _handleWalletButtonClick(): void  {
        const payload = this._createMasterpassPayload();
        this.masterpassClient.checkout(payload);
    }

    private get masterpassClient(): Masterpass {
        if (!this._masterpassClient) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        return this._masterpassClient;
    }

    private get paymentMethod(): PaymentMethod {
        if (!this._paymentMethod) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        return this._paymentMethod;
    }

    private get checkout(): Checkout {
        if (!this._checkout) {
            throw new MissingDataError(MissingDataErrorType.MissingCart);
        }

        return this._checkout;
    }

}
