import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './zenstack/schema';

async function main() {
    const db = new ZenStackClient(schema, {
        computedFields: {
            User: {
                // provide implementation of the "User.emailDomain" computed field
                emailDomain: (eb) =>
                    // build SQL expression: substr(email, instr(email, '@') + 1)
                    eb.fn('substr', [
                        eb.ref('email'),
                        eb(
                            eb.fn('instr', [eb.ref('email'), eb.val('@')]),
                            '+',
                            1
                        ),
                    ]),
            },
        },
    }).$use({
        id: 'logging',
        beforeQuery(args) {
            console.log(
                '[before] ',
                args.model,
                args.operation,
                args.args ?? ''
            );
        },
        afterQuery(args) {
            console.log(
                '[after ] ',
                args.model,
                args.operation,
                args.result ?? args.error
            );
        },
    });

    // clean up existing data
    await db.post.deleteMany();
    await db.profile.deleteMany();
    await db.user.deleteMany();
}

main();
