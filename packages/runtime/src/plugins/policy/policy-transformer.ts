import {
    AliasNode,
    AndNode,
    OperationNodeTransformer,
    OrNode,
    SelectQueryNode,
    TableNode,
    UnaryOperationNode,
    ValueNode,
    WhereNode,
    type OperationNode,
} from 'kysely';
import type { ClientContract } from '../../client';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base';
import { requireModel } from '../../client/query-utils';
import type { GetModels, SchemaDef } from '../../schema';
import type { Policy } from '../../schema/schema';
import { ExpressionTransformer } from './expression-transformer';
import type { PolicyOptions } from './options';

export class PolicyTransformer<
    Schema extends SchemaDef
> extends OperationNodeTransformer {
    private readonly dialect: BaseCrudDialect<Schema>;

    constructor(
        private readonly client: ClientContract<Schema>,
        private readonly options: PolicyOptions<Schema>
    ) {
        super();
        this.dialect = getCrudDialect(client.$schema, client.$options);
    }

    protected override transformSelectQuery(node: SelectQueryNode) {
        let whereNode = node.where;

        node.from?.froms.forEach((from) => {
            let modelName = this.extractTableName(from);
            const policies = this.getModelPolicies(modelName);
            if (policies && policies.length > 0) {
                const combinedPolicy = this.buildPolicyFilterNode(
                    modelName as GetModels<Schema>,
                    policies
                );
                whereNode = WhereNode.create(
                    whereNode?.where
                        ? AndNode.create(whereNode.where, combinedPolicy)
                        : combinedPolicy
                );
            }
        });

        const baseResult = super.transformSelectQuery({
            ...node,
            where: undefined,
        });

        return {
            ...baseResult,
            where: whereNode,
        };
    }

    private buildPolicyFilterNode(
        model: GetModels<Schema>,
        policies: Policy[]
    ) {
        const allows = policies
            .filter((policy) => policy.kind === 'allow')
            .map((policy) => this.buildPolicyWhere(model, policy));

        const denies = policies
            .filter((policy) => policy.kind === 'deny')
            .map((policy) => this.buildPolicyWhere(model, policy));

        let combinedPolicy: OperationNode;

        if (allows.length === 0) {
            // constant false
            combinedPolicy = ValueNode.create(
                this.dialect.transformPrimitive(false, 'Boolean')
            );
        } else {
            // or(...allows)
            combinedPolicy = allows.reduce((prev, curr, i) =>
                i === 0 ? curr : OrNode.create(prev, curr)
            );

            // and(...!denies)
            if (denies.length !== 0) {
                const combinedDenies = denies.reduce((prev, curr, i) =>
                    i === 0
                        ? UnaryOperationNode.create(ValueNode.create('!'), curr)
                        : AndNode.create(
                              prev,
                              UnaryOperationNode.create(
                                  ValueNode.create('!'),
                                  curr
                              )
                          )
                );

                // or(...allows) && and(...!denies)
                combinedPolicy = AndNode.create(combinedPolicy, combinedDenies);
            }
        }
        return combinedPolicy;
    }

    private extractTableName(from: OperationNode): string {
        if (TableNode.is(from)) {
            return from.table.identifier.name;
        }
        if (AliasNode.is(from)) {
            return this.extractTableName(from.node);
        } else {
            throw new Error(`Unexpected "from" node kind: ${from.kind}`);
        }
    }

    private buildPolicyWhere(model: GetModels<Schema>, policy: Policy) {
        return new ExpressionTransformer(this.client, this.options).transform(
            policy.expression,
            { model }
        );
    }

    private getModelPolicies(modelName: string) {
        return requireModel(this.client.$schema, modelName).policies;
    }
}
