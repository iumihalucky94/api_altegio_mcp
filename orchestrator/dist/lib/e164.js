"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeE164 = normalizeE164;
exports.isValidE164 = isValidE164;
exports.formatForDisplay = formatForDisplay;
const E164_RE = /^\+?[1-9]\d{1,14}$/;
function normalizeE164(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 0)
        return '';
    return digits.startsWith('0') ? `+${digits.slice(1)}` : `+${digits}`;
}
function isValidE164(phone) {
    const n = normalizeE164(phone);
    return n.length > 0 && E164_RE.test(n);
}
function formatForDisplay(phone) {
    return normalizeE164(phone) || phone;
}
//# sourceMappingURL=e164.js.map