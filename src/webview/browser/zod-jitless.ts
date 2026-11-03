// zod compiles parsers with `new Function` unless told not to, and checks
// whether it may as each schema is defined. The page's Content-Security-Policy
// allows no eval, so this module is imported before any schema exists.
import * as z from 'zod';

z.config({ jitless: true });
