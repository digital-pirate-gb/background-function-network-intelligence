"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
exports.testConnection = testConnection;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
if (!process.env.SUPABASE_URL) {
    throw new Error('Missing environment variable: SUPABASE_URL');
}
if (!process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');
}
exports.supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: {
        persistSession: false,
    },
    db: {
        schema: 'public'
    }
});
async function testConnection() {
    try {
        const { error } = await exports.supabase
            .from('uploads')
            .select('count')
            .limit(1);
        if (error) {
            console.error('❌ Supabase connection test failed:', error.message);
            process.exit(1);
        }
        console.log('✅ Supabase connection established');
    }
    catch (error) {
        console.error('❌ Failed to connect to Supabase:', error);
        process.exit(1);
    }
}
//# sourceMappingURL=supabase.js.map