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
import type { SchemaDef } from '../../../schema';
import type { Policy } from '../../../schema/schema';
import type { QueryDialect } from '../../operations/dialect';
import { requireModel } from '../../query-utils';
import type { PolicyFeatureSettings } from '../../types';
import { ExpressionTransformer } from './expression-transformer';

export class PolicyTransformer extends OperationNodeTransformer {
    constructor(
        private readonly schema: SchemaDef,
        private readonly queryDialect: QueryDialect,
        private readonly policySettings: PolicyFeatureSettings
    ) {
        super();
    }

    protected override transformSelectQuery(node: SelectQueryNode) {
        let whereNode = node.where;

        node.from?.froms.forEach((from) => {
            let modelName = this.extractTableName(from);
            const policies = this.getModelPolicies(modelName);
            if (policies && policies.length > 0) {
                const combinedPolicy = this.buildPolicyFilterNode(policies);
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

    private buildPolicyFilterNode(policies: Policy[]) {
        const allows = policies
            .filter((policy) => policy.kind === 'allow')
            .map((policy) => this.buildPolicyWhere(policy));

        const denies = policies
            .filter((policy) => policy.kind === 'deny')
            .map((policy) => this.buildPolicyWhere(policy));

        let combinedPolicy: OperationNode;

        if (allows.length === 0) {
            // constant false
            combinedPolicy = ValueNode.create(
                this.queryDialect.transformPrimitive(false, 'Boolean')
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

    private buildPolicyWhere(policy: Policy) {
        return new ExpressionTransformer(
            this.schema,
            this.queryDialect,
            this.policySettings
        ).transform(policy.expression);
    }

    private getModelPolicies(modelName: string) {
        return requireModel(this.schema, modelName).policies;
    }
}
