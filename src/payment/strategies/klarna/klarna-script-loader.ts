import { ScriptLoader } from '@bigcommerce/script-loader';

import KlarnaCredit from './klarna-credit';
import KlarnaPayments from './klarna-payments';
import KlarnaWindow from './klarna-window';
import KlarnaV2Window from './klarnav2-window';

const KLARNA_CREDIT_URL = '//credit.klarnacdn.net/lib/v1/api.js';
const KLARNA_PAYMENTS_URL = 'https://x.klarnacdn.net/kp/lib/v1/api.js';

export default class KlarnaScriptLoader {
    constructor(
        private _scriptLoader: ScriptLoader
    ) {}

    loadCredit(): Promise<KlarnaCredit> {
        return this._scriptLoader.loadScript(KLARNA_CREDIT_URL)
            .then(() => (window as unknown as KlarnaWindow).Klarna.Credit);
    }

    loadPayments(): Promise<KlarnaPayments> {
        return this._scriptLoader.loadScript(KLARNA_PAYMENTS_URL)
            .then(() => (window as unknown as KlarnaV2Window).Klarna.Payments);
    }
}
