import { match } from 'ts-pattern';
import {
    Expression,
    type ArrayExpression,
    type BinaryExpression,
    type CallExpression,
    type FieldExpression,
    type LiteralExpression,
    type MemberExpression,
    type UnaryExpression,
} from '../../schema';
import invariant from 'tiny-invariant';

type ExpressionEvaluatorContext = {
    auth?: any;
    thisValue?: any;
};

/**
 * Evaluate a schema expression into a JavaScript value.
 */
export class ExpressionEvaluator {
    evaluate(expression: Expression, context: ExpressionEvaluatorContext): any {
        const result = match(expression)
            .when(Expression.isArray, (expr) =>
                this.evaluateArray(expr, context)
            )
            .when(Expression.isBinary, (expr) =>
                this.evaluateBinary(expr, context)
            )
            .when(Expression.isField, (expr) =>
                this.evaluateField(expr, context)
            )
            .when(Expression.isLiteral, (expr) => this.evaluateLiteral(expr))
            .when(Expression.isMember, (expr) =>
                this.evaluateMember(expr, context)
            )
            .when(Expression.isUnary, (expr) =>
                this.evaluateUnary(expr, context)
            )
            .when(Expression.isCall, (expr) => this.evaluateCall(expr, context))
            .when(Expression.isThis, () => context.thisValue)
            .when(Expression.isNull, () => null)
            .exhaustive();

        return result ?? null;
    }

    private evaluateCall(
        expr: CallExpression,
        context: ExpressionEvaluatorContext
    ): any {
        if (expr.function === 'auth') {
            return context.auth;
        } else {
            throw new Error(
                `Unsupported call expression function: ${expr.function}`
            );
        }
    }

    private evaluateUnary(
        expr: UnaryExpression,
        context: ExpressionEvaluatorContext
    ) {
        return match(expr.op)
            .with('!', () => !this.evaluate(expr.operand, context))
            .exhaustive();
    }

    private evaluateMember(
        expr: MemberExpression,
        context: ExpressionEvaluatorContext
    ) {
        let val = this.evaluate(expr.receiver, context);
        for (const member of expr.members) {
            val = val?.[member];
        }
        return val;
    }

    private evaluateLiteral(expr: LiteralExpression): any {
        return expr.value;
    }

    private evaluateField(
        expr: FieldExpression,
        context: ExpressionEvaluatorContext
    ): any {
        return context.thisValue?.[expr.field];
    }

    private evaluateArray(
        expr: ArrayExpression,
        context: ExpressionEvaluatorContext
    ) {
        return expr.items.map((item) => this.evaluate(item, context));
    }

    private evaluateBinary(
        expr: BinaryExpression,
        context: ExpressionEvaluatorContext
    ) {
        if (expr.op === '?' || expr.op === '!' || expr.op === '^') {
            return this.evaluateCollectionPredicate(expr, context);
        }

        const left = this.evaluate(expr.left, context);
        const right = this.evaluate(expr.right, context);

        return match(expr.op)
            .with('==', () => left === right)
            .with('!=', () => left !== right)
            .with('>', () => left > right)
            .with('>=', () => left >= right)
            .with('<', () => left < right)
            .with('<=', () => left <= right)
            .with('&&', () => left && right)
            .with('||', () => left || right)
            .exhaustive();
    }

    private evaluateCollectionPredicate(
        expr: BinaryExpression,
        context: ExpressionEvaluatorContext
    ) {
        const op = expr.op;
        invariant(
            op === '?' || op === '!' || op === '^',
            'expected "?" or "!" or "^" operator'
        );

        const left = this.evaluate(expr.left, context);
        if (!left) {
            return false;
        }

        invariant(Array.isArray(left), 'expected array');

        return match(op)
            .with('?', () =>
                left.some((item: any) =>
                    this.evaluate(expr.right, { ...context, thisValue: item })
                )
            )
            .with('!', () =>
                left.every((item: any) =>
                    this.evaluate(expr.right, { ...context, thisValue: item })
                )
            )
            .with(
                '^',
                () =>
                    !left.some((item: any) =>
                        this.evaluate(expr.right, {
                            ...context,
                            thisValue: item,
                        })
                    )
            )
            .exhaustive();
    }
}
