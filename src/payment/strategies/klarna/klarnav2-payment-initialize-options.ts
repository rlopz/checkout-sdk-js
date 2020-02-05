import { KlarnaLoadResponse } from './klarna-payments';

/**
 * A set of options that are required to initialize the KlarnaV2 payment method.
 *
 * When KlarnaV2 is initialized, a list of payment options will be displayed for the customer to choose from.
 * Each one with its own widget.
 */
export default interface KlarnaV2PaymentInitializeOptions {
    /**
     * The ID of a container which the payment widget should insert into.
     */
    container: string;
    /**
     * The payment_method_category specifies which of Klarna’s customer offerings
     * (Pay now, Pay later or Slice it) that is being shown.
     */
    payment_method_category: string;

    /**
     * A callback that gets called when the widget is loaded and ready to be
     * interacted with.
     *
     * @param response - The result of the initialization. It indicates whether
     * or not the widget is loaded successfully.
     */
    onLoad?(response: KlarnaLoadResponse): void;
}
