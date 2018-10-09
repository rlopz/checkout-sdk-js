import { IFrameComponent } from 'iframe-resizer';

import { EmbeddedCheckoutEventMap, EmbeddedCheckoutEventType } from './embedded-checkout-events';
import EmbeddedCheckoutOptions from './embedded-checkout-options';
import { EmbeddedContentEvent, EmbeddedContentEventType } from './iframe-content/embedded-content-events';
import IframeEventListener from './iframe-event-listener';
import IframeEventPoster from './iframe-event-poster';
import parseOrigin from './parse-origin';
import ResizableIframeCreator from './resizable-iframe-creator';

export default class EmbeddedCheckout {
    private _iframe?: IFrameComponent;
    private _isAttached: boolean;

    /**
     * @internal
     */
    constructor(
        private _iframeCreator: ResizableIframeCreator,
        private _messageListener: IframeEventListener<EmbeddedCheckoutEventMap>,
        private _options: EmbeddedCheckoutOptions
    ) {
        this._isAttached = false;

        if (this._options.onComplete) {
            this._messageListener.addListener(EmbeddedCheckoutEventType.CheckoutComplete, this._options.onComplete);
        }

        if (this._options.onError) {
            this._messageListener.addListener(EmbeddedCheckoutEventType.CheckoutError, this._options.onError);
        }

        if (this._options.onLoad) {
            this._messageListener.addListener(EmbeddedCheckoutEventType.CheckoutLoaded, this._options.onLoad);
        }

        if (this._options.onFrameLoad) {
            this._messageListener.addListener(EmbeddedCheckoutEventType.FrameLoaded, this._options.onFrameLoad);
        }
    }

    attach(): Promise<this> {
        if (this._isAttached) {
            return Promise.resolve(this);
        }

        this._isAttached = true;
        this._messageListener.listen();

        return this._iframeCreator.createFrame(this._options.url, this._options.containerId)
            .then(iframe => {
                if (iframe.contentWindow && this._options.styles) {
                    const messagePoster = new IframeEventPoster<EmbeddedContentEvent>(
                        parseOrigin(this._options.url),
                        iframe.contentWindow
                    );

                    messagePoster.post({
                        type: EmbeddedContentEventType.StyleConfigured,
                        payload: this._options.styles,
                    });
                }

                this._iframe = iframe;

                return this;
            })
            .catch(error => {
                this._isAttached = false;

                this._messageListener.trigger({
                    type: EmbeddedCheckoutEventType.FrameError,
                    payload: error,
                });

                throw error;
            });
    }

    detach(): void {
        if (!this._isAttached) {
            return;
        }

        this._isAttached = false;
        this._messageListener.stopListen();

        if (this._iframe && this._iframe.parentNode) {
            this._iframe.parentNode.removeChild(this._iframe);
            this._iframe.iFrameResizer.close();
        }
    }
}
