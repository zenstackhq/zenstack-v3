import { ExpressionWrapper, ValueNode, type Expression, type ExpressionBuilder } from 'kysely';
import type { ZModelFunction, ZModelFunctionContext } from '../../client/options';
import { invariant } from '@zenstackhq/common-helpers';
import { buildJoinPairs, requireField } from '../../client/query-utils';
import { PolicyHandler } from './policy-handler';
import type { CRUD } from '../../client/contract';
import { extractFieldName } from '../../client/kysely-utils';

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
            ['create', 'read', 'update', 'delete'].includes(arg2Node.value),
            '"operation" parameter must be one of "create", "read", "update", "delete"',
        );
    }

    // first argument must be a field reference
    const fieldName = extractFieldName(arg1Node);
    invariant(fieldName, 'Failed to extract field name from the first argument of "check" function');
    const fieldDef = requireField(client.$schema, model, fieldName);
    invariant(fieldDef.relation, `Field "${fieldName}" is not a relation field in model "${model}"`);
    invariant(!fieldDef.array, `Field "${fieldName}" is a to-many relation, which is not supported by "check"`);
    const relationModel = fieldDef.type;

    const op = arg2Node ? (arg2Node.value as CRUD) : operation;

    const policyHandler = new PolicyHandler(client);

    // join with parent model
    const joinPairs = buildJoinPairs(client.$schema, model, modelAlias, fieldName, relationModel);
    const joinCondition =
        joinPairs.length === 1
            ? eb(eb.ref(joinPairs[0]![0]), '=', eb.ref(joinPairs[0]![1]))
            : eb.and(joinPairs.map(([left, right]) => eb(eb.ref(left), '=', eb.ref(right))));

    // policy condition of the related model
    const policyCondition = policyHandler.buildPolicyFilter(relationModel, undefined, op);

    // build the final nested select that evaluates the policy condition
    const result = eb
        .selectFrom(relationModel)
        .where(joinCondition)
        .select(new ExpressionWrapper(policyCondition).as('$condition'));

    return result;
};
