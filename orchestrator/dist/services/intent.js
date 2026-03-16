"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyIntent = classifyIntent;
exports.detectLanguage = detectLanguage;
function classifyIntent(text) {
    const t = (text || '').toLowerCase();
    // Complaint / emotional
    if (/\b(beschwer|beschweren|unzufrieden|schlecht|злая|плохо|жалоб|груб|хамств|konflikt|problem)\b/.test(t)) {
        return 'COMPLAINT_OR_EMOTIONAL';
    }
    // Discount / fee
    if (/\b(rabatt|discount|скидк|ausfallgebühr|no-show fee|strafgebühr)\b/.test(t)) {
        return 'COMPLAINT_OR_EMOTIONAL';
    }
    // Cancel
    if (/\b(cancel|absa|stornier|отмен|sagen.*ab\b)\b/.test(t)) {
        return 'CANCEL_REQUEST';
    }
    // Reschedule
    if (/\b(verschieb|verlegen|später|ander[e]?n? termin|перенес|переехать время|не могу прийти)\b/.test(t)) {
        return 'RESCHEDULE';
    }
    // Late
    if (/\b(zu spät|komme.*spät|опазд|verspätung|ich bin unterwegs|я уже еду)\b/.test(t)) {
        return 'LATE_NOTICE';
    }
    // Policy question
    if (/\b(storno|stornobedingung|regeln|policy|regelung|правил|полити|залог|предоплат|депозит)\b/.test(t)) {
        return 'POLICY_QUESTION';
    }
    // Service not provided
    if (/\b(brow lamination|augenbrau|бров|маникюр|педикюр|волос|haircut|massage)\b/.test(t)) {
        return 'SERVICE_NOT_PROVIDED';
    }
    // Booking keywords
    if (/\b(termin|appointment|записат|запись|коррекц|refill|auffüllung|neues set|new set|nächste woche|am dienstag|am samstag|как можно скорее|окошек|окошко|есть место|есть слот|реснич|wimpern|lash)\b/.test(t)) {
        return 'BOOKING';
    }
    return 'UNKNOWN';
}
function detectLanguage(text, override) {
    const allowed = ['de', 'ru', 'en', 'mixed'];
    if (override && allowed.includes(override)) {
        return override;
    }
    const t = text || '';
    const hasCyrillic = /[А-Яа-яЁё]/.test(t);
    const hasLatin = /[A-Za-z]/.test(t);
    const hasGermanHints = /[äöüß]/i.test(t) || /\b(termin|bitte|danke|nicht|gern[e]?|sie\b)\b/i.test(t);
    if (hasCyrillic && hasLatin)
        return 'mixed';
    if (hasCyrillic)
        return 'ru';
    if (hasGermanHints)
        return 'de';
    if (hasLatin)
        return 'en';
    return 'de';
}
//# sourceMappingURL=intent.js.map