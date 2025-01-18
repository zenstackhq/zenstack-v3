import type {
    AstNode,
    LangiumDocument,
    ValidationAcceptor,
    ValidationChecks,
} from 'langium';
import type {
    Attribute,
    DataModel,
    DataSource,
    Enum,
    Expression,
    FunctionDecl,
    InvocationExpr,
    Model,
    TypeDef,
    ZModelAstType,
} from './generated/ast';
import type { ZModelServices } from './module.js';
import AttributeValidator from './validators/attribute-validator';
import DataModelValidator from './validators/datamodel-validator';
import DataSourceValidator from './validators/datasource-validator';
import EnumValidator from './validators/enum-validator';
import ExpressionValidator from './validators/expression-validator';
import FunctionDeclValidator from './validators/function-decl-validator';
import FunctionInvocationValidator from './validators/function-invocation-validator';
import SchemaValidator from './validators/schema-validator';
import TypeDefValidator from './validators/typedef-validator';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ZModelServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.ZModelValidator;
    const checks: ValidationChecks<ZModelAstType> = {
        Model: validator.checkModel,
        DataSource: validator.checkDataSource,
        DataModel: validator.checkDataModel,
        TypeDef: validator.checkTypeDef,
        Enum: validator.checkEnum,
        Attribute: validator.checkAttribute,
        Expression: validator.checkExpression,
        InvocationExpr: validator.checkFunctionInvocation,
        FunctionDecl: validator.checkFunctionDecl,
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class ZModelValidator {
    constructor(protected readonly services: ZModelServices) {}

    private shouldCheck(node: AstNode) {
        let doc: LangiumDocument | undefined;
        let currNode: AstNode | undefined = node;
        while (currNode) {
            if (currNode.$document) {
                doc = currNode.$document;
                break;
            }
            currNode = currNode.$container;
        }

        return (
            doc?.parseResult.lexerErrors.length === 0 &&
            doc?.parseResult.parserErrors.length === 0
        );
    }

    checkModel(node: Model, accept: ValidationAcceptor): void {
        this.shouldCheck(node) &&
            new SchemaValidator(
                this.services.shared.workspace.LangiumDocuments
            ).validate(node, accept);
    }

    checkDataSource(node: DataSource, accept: ValidationAcceptor): void {
        this.shouldCheck(node) &&
            new DataSourceValidator().validate(node, accept);
    }

    checkDataModel(node: DataModel, accept: ValidationAcceptor): void {
        this.shouldCheck(node) &&
            new DataModelValidator().validate(node, accept);
    }

    checkTypeDef(node: TypeDef, accept: ValidationAcceptor): void {
        this.shouldCheck(node) && new TypeDefValidator().validate(node, accept);
    }

    checkEnum(node: Enum, accept: ValidationAcceptor): void {
        this.shouldCheck(node) && new EnumValidator().validate(node, accept);
    }

    checkAttribute(node: Attribute, accept: ValidationAcceptor): void {
        this.shouldCheck(node) &&
            new AttributeValidator().validate(node, accept);
    }

    checkExpression(node: Expression, accept: ValidationAcceptor): void {
        this.shouldCheck(node) &&
            new ExpressionValidator().validate(node, accept);
    }

    checkFunctionInvocation(
        node: InvocationExpr,
        accept: ValidationAcceptor
    ): void {
        this.shouldCheck(node) &&
            new FunctionInvocationValidator().validate(node, accept);
    }

    checkFunctionDecl(node: FunctionDecl, accept: ValidationAcceptor): void {
        this.shouldCheck(node) &&
            new FunctionDeclValidator().validate(node, accept);
    }
}
