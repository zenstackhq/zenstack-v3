import { invariant } from '@zenstackhq/common-helpers';
import type { ZModelFunction, ZModelFunctionContext } from '@zenstackhq/orm';
import { CRUD, QueryUtils } from '@zenstackhq/orm';
import { ExpressionWrapper, ValueNode, type Expression, type ExpressionBuilder } from 'kysely';
import { PolicyHandler } from './policy-handler';

/**
 * Relation checker implementation.
 */
export const check: ZModelFunction<any> = (
    eb: ExpressionBuilder<any, any>,
    args: Expression<any>[],
    { client, model, modelAlias, operation }: ZModelFunctionContext<any>,
) => {
    invariant(args.length === 1 || args.length === 2, '"check" function requires 1 or 2 arguments');

    const arg1Node = args[0]!.toOperationNode();

    const arg2Node = args.length === 2 ? args[1]!.toOperationNode() : undefined;
    if (arg2Node) {
        invariant(
            ValueNode.is(arg2Node) && typeof arg2Node.value === 'string',
            '"operation" parameter must be a string literal when provided',
        );
        invariant(
            CRUD.includes(arg2Node.value as CRUD),
            '"operation" parameter must be one of "create", "read", "update", "delete"',
        );
    }

    // first argument must be a field reference
    const fieldName = QueryUtils.extractFieldName(arg1Node);
    invariant(fieldName, 'Failed to extract field name from the first argument of "check" function');
    const fieldDef = QueryUtils.requireField(client.$schema, model, fieldName);
    invariant(fieldDef.relation, `Field "${fieldName}" is not a relation field in model "${model}"`);
    invariant(!fieldDef.array, `Field "${fieldName}" is a to-many relation, which is not supported by "check"`);
    const relationModel = fieldDef.type;

    // build the join condition between the current model and the related model
    const joinConditions: Expression<any>[] = [];
    const fkInfo = QueryUtils.getRelationForeignKeyFieldPairs(client.$schema, model, fieldName);
    const idFields = QueryUtils.requireIdFields(client.$schema, model);

    // helper to build a base model select for delegate models
    const buildBaseSelect = (baseModel: string, field: string): Expression<any> => {
        return eb
            .selectFrom(baseModel)
            .select(field)
            .where(
                eb.and(
                    idFields.map((idField) =>
                        eb(eb.ref(`${fieldDef.originModel}.${idField}`), '=', eb.ref(`${modelAlias}.${idField}`)),
                    ),
                ),
            );
    };

    if (fkInfo.ownedByModel) {
        // model owns the relation
        joinConditions.push(
            ...fkInfo.keyPairs.map(({ fk, pk }) => {
                let fkRef: Expression<any>;
                if (fieldDef.originModel && fieldDef.originModel !== model) {
                    // relation is actually defined in a delegate base model, select from there
                    fkRef = buildBaseSelect(fieldDef.originModel, fk);
                } else {
                    fkRef = eb.ref(`${modelAlias}.${fk}`);
                }
                return eb(fkRef, '=', eb.ref(`${relationModel}.${pk}`));
            }),
        );
    } else {
        // related model owns the relation
        joinConditions.push(
            ...fkInfo.keyPairs.map(({ fk, pk }) => {
                let pkRef: Expression<any>;
                if (fieldDef.originModel && fieldDef.originModel !== model) {
                    // relation is actually defined in a delegate base model, select from there
                    pkRef = buildBaseSelect(fieldDef.originModel, pk);
                } else {
                    pkRef = eb.ref(`${modelAlias}.${pk}`);
                }
                return eb(pkRef, '=', eb.ref(`${relationModel}.${fk}`));
            }),
        );
    }

    const joinCondition = joinConditions.length === 1 ? joinConditions[0]! : eb.and(joinConditions);

    // policy condition of the related model
    const policyHandler = new PolicyHandler(client);
    const op = arg2Node ? (arg2Node.value as CRUD) : operation;
    const policyCondition = policyHandler.buildPolicyFilter(relationModel, undefined, op);

    // build the final nested select that evaluates the policy condition
    const result = eb
        .selectFrom(
            eb
                .selectFrom(relationModel)
                .where(joinCondition)
                .select(new ExpressionWrapper(policyCondition).as('$condition'))
                .as('$sub'),
        )
        .selectAll();

    return result;
};
