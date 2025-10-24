import { match } from 'ts-pattern';
import type {
    ArrayExpression,
    BinaryExpression,
    CallExpression,
    Expression,
    FieldExpression,
    LiteralExpression,
    MemberExpression,
    NullExpression,
    ThisExpression,
    UnaryExpression,
} from '../schema';

export class ExpressionVisitor {
    visit(expr: Expression): void {
        match(expr)
            .with({ kind: 'literal' }, (e) => this.visitLiteral(e))
            .with({ kind: 'array' }, (e) => this.visitArray(e))
            .with({ kind: 'field' }, (e) => this.visitField(e))
            .with({ kind: 'member' }, (e) => this.visitMember(e))
            .with({ kind: 'binary' }, (e) => this.visitBinary(e))
            .with({ kind: 'unary' }, (e) => this.visitUnary(e))
            .with({ kind: 'call' }, (e) => this.visitCall(e))
            .with({ kind: 'this' }, (e) => this.visitThis(e))
            .with({ kind: 'null' }, (e) => this.visitNull(e))
            .exhaustive();
    }

    protected visitLiteral(_e: LiteralExpression) {}

    protected visitArray(e: ArrayExpression) {
        e.items.forEach((item) => this.visit(item));
    }

    protected visitField(_e: FieldExpression) {}

    protected visitMember(e: MemberExpression) {
        this.visit(e.receiver);
    }

    protected visitBinary(e: BinaryExpression) {
        this.visit(e.left);
        this.visit(e.right);
    }

    protected visitUnary(e: UnaryExpression) {
        this.visit(e.operand);
    }

    protected visitCall(e: CallExpression) {
        e.args?.forEach((arg) => this.visit(arg));
    }

    protected visitThis(_e: ThisExpression) {}

    protected visitNull(_e: NullExpression) {}
}
