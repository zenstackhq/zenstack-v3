import {
    AstUtils,
    Cancellation,
    DefaultScopeComputation,
    DefaultScopeProvider,
    EMPTY_SCOPE,
    StreamScope,
    UriUtils,
    interruptAndCheck,
    type AstNode,
    type AstNodeDescription,
    type LangiumCoreServices,
    type LangiumDocument,
    type PrecomputedScopes,
    type ReferenceInfo,
    type Scope,
} from 'langium';
import { match } from 'ts-pattern';
import {
    BinaryExpr,
    MemberAccessExpr,
    isDataField,
    isDataModel,
    isEnumField,
    isInvocationExpr,
    isMemberAccessExpr,
    isModel,
    isReferenceExpr,
    isThisExpr,
    isTypeDef,
} from './ast';
import { PLUGIN_MODULE_NAME, STD_LIB_MODULE_NAME } from './constants';
import {
    getAllFields,
    getAllLoadedAndReachableDataModelsAndTypeDefs,
    getAuthDecl,
    getRecursiveBases,
    isAuthInvocation,
    isBeforeInvocation,
    isCollectionPredicate,
    resolveImportUri,
} from './utils';

/**
 * Custom Langium ScopeComputation implementation which adds enum fields into global scope
 */
export class ZModelScopeComputation extends DefaultScopeComputation {
    constructor(private readonly services: LangiumCoreServices) {
        super(services);
    }

    override async computeExports(
        document: LangiumDocument<AstNode>,
        cancelToken?: Cancellation.CancellationToken | undefined,
    ): Promise<AstNodeDescription[]> {
        const result = await super.computeExports(document, cancelToken);

        // add enum fields so they can be globally resolved across modules
        for (const node of AstUtils.streamAllContents(document.parseResult.value)) {
            if (cancelToken) {
                await interruptAndCheck(cancelToken);
            }
            if (isEnumField(node)) {
                const desc = this.services.workspace.AstNodeDescriptionProvider.createDescription(
                    node,
                    node.name,
                    document,
                );
                result.push(desc);
            }
        }

        return result;
    }

    override processNode(node: AstNode, document: LangiumDocument<AstNode>, scopes: PrecomputedScopes) {
        super.processNode(node, document, scopes);
        if (isDataModel(node) || isTypeDef(node)) {
            // add base fields to the scope recursively
            const bases = getRecursiveBases(node);
            for (const base of bases) {
                for (const field of base.fields) {
                    scopes.add(node, this.descriptions.createDescription(field, this.nameProvider.getName(field)));
                }
            }
        }
    }
}

export class ZModelScopeProvider extends DefaultScopeProvider {
    constructor(private readonly services: LangiumCoreServices) {
        super(services);
    }

    protected override getGlobalScope(referenceType: string, context: ReferenceInfo): Scope {
        const model = AstUtils.getContainerOfType(context.container, isModel);
        if (!model) {
            return EMPTY_SCOPE;
        }

        const importedUris = model.imports.map(resolveImportUri).filter((url) => !!url);

        const importedElements = this.indexManager.allElements(referenceType).filter(
            (des) =>
                // allow current document
                UriUtils.equals(des.documentUri, model.$document?.uri) ||
                // allow stdlib
                des.documentUri.path.endsWith(STD_LIB_MODULE_NAME) ||
                // allow plugin models
                des.documentUri.path.endsWith(PLUGIN_MODULE_NAME) ||
                // allow imported documents
                importedUris.some((importedUri) => UriUtils.equals(des.documentUri, importedUri)),
        );
        return new StreamScope(importedElements);
    }

    override getScope(context: ReferenceInfo): Scope {
        if (isMemberAccessExpr(context.container) && context.container.operand && context.property === 'member') {
            return this.getMemberAccessScope(context);
        }

        if (isReferenceExpr(context.container) && context.property === 'target') {
            // when reference expression is resolved inside a collection predicate, the scope is the collection
            const containerCollectionPredicate = getCollectionPredicateContext(context.container);
            if (containerCollectionPredicate) {
                return this.getCollectionPredicateScope(context, containerCollectionPredicate as BinaryExpr);
            }
        }

        return super.getScope(context);
    }

    private getMemberAccessScope(context: ReferenceInfo) {
        const referenceType = this.reflection.getReferenceType(context);
        const globalScope = this.getGlobalScope(referenceType, context);
        const node = context.container as MemberAccessExpr;

        // typedef's fields are only added to the scope if the access starts with `auth().`
        // or the member access resides inside a typedef
        const allowTypeDefScope =
            // isAuthOrAuthMemberAccess(node.operand) ||
            !!AstUtils.getContainerOfType(node, isTypeDef);

        return match(node.operand)
            .when(isReferenceExpr, (operand) => {
                // operand is a reference, it can only be a model/type-def field
                const ref = operand.target.ref;
                if (isDataField(ref)) {
                    return this.createScopeForContainer(ref.type.reference?.ref, globalScope, allowTypeDefScope);
                }
                return EMPTY_SCOPE;
            })
            .when(isMemberAccessExpr, (operand) => {
                // operand is a member access, it must be resolved to a non-array model/typedef type
                const ref = operand.member.ref;
                if (isDataField(ref) && !ref.type.array) {
                    return this.createScopeForContainer(ref.type.reference?.ref, globalScope, allowTypeDefScope);
                }
                return EMPTY_SCOPE;
            })
            .when(isThisExpr, () => {
                // operand is `this`, resolve to the containing model
                return this.createScopeForContainingModel(node, globalScope);
            })
            .when(isInvocationExpr, (operand) => {
                // deal with member access from `auth()` and `future()

                if (isAuthInvocation(operand)) {
                    // resolve to `User` or `@@auth` decl
                    return this.createScopeForAuth(node, globalScope);
                }

                if (isBeforeInvocation(operand)) {
                    // resolve `before()` to the containing model
                    return this.createScopeForContainingModel(node, globalScope);
                }
                return EMPTY_SCOPE;
            })
            .otherwise(() => EMPTY_SCOPE);
    }

    private getCollectionPredicateScope(context: ReferenceInfo, collectionPredicate: BinaryExpr) {
        const referenceType = this.reflection.getReferenceType(context);
        const globalScope = this.getGlobalScope(referenceType, context);
        const collection = collectionPredicate.left;

        // TODO: generalize it
        // // typedef's fields are only added to the scope if the access starts with `auth().`
        // const allowTypeDefScope = isAuthOrAuthMemberAccess(collection);
        const allowTypeDefScope = false;

        return match(collection)
            .when(isReferenceExpr, (expr) => {
                // collection is a reference - model or typedef field
                const ref = expr.target.ref;
                if (isDataField(ref)) {
                    return this.createScopeForContainer(ref.type.reference?.ref, globalScope, allowTypeDefScope);
                }
                return EMPTY_SCOPE;
            })
            .when(isMemberAccessExpr, (expr) => {
                // collection is a member access, it can only be resolved to a model or typedef field
                const ref = expr.member.ref;
                if (isDataField(ref)) {
                    return this.createScopeForContainer(ref.type.reference?.ref, globalScope, allowTypeDefScope);
                }
                return EMPTY_SCOPE;
            })
            .when(isInvocationExpr, (expr) => {
                const returnTypeDecl = expr.function.ref?.returnType.reference?.ref;
                if (isDataModel(returnTypeDecl)) {
                    return this.createScopeForContainer(returnTypeDecl, globalScope, allowTypeDefScope);
                } else {
                    return EMPTY_SCOPE;
                }
            })
            .when(isAuthInvocation, (expr) => {
                return this.createScopeForAuth(expr, globalScope);
            })
            .otherwise(() => EMPTY_SCOPE);
    }

    private createScopeForContainingModel(node: AstNode, globalScope: Scope) {
        const model = AstUtils.getContainerOfType(node, isDataModel);
        if (model) {
            return this.createScopeForContainer(model, globalScope);
        } else {
            return EMPTY_SCOPE;
        }
    }

    private createScopeForContainer(node: AstNode | undefined, globalScope: Scope, includeTypeDefScope = false) {
        if (isDataModel(node)) {
            return this.createScopeForNodes(getAllFields(node), globalScope);
        } else if (includeTypeDefScope && isTypeDef(node)) {
            return this.createScopeForNodes(node.fields, globalScope);
        } else {
            return EMPTY_SCOPE;
        }
    }

    private createScopeForAuth(node: AstNode, globalScope: Scope) {
        // get all data models and type defs from loaded and reachable documents
        const decls = getAllLoadedAndReachableDataModelsAndTypeDefs(
            this.services.shared.workspace.LangiumDocuments,
            AstUtils.getContainerOfType(node, isDataModel),
        );

        const authDecl = getAuthDecl(decls);
        if (authDecl) {
            return this.createScopeForContainer(authDecl, globalScope, true);
        } else {
            return EMPTY_SCOPE;
        }
    }
}

function getCollectionPredicateContext(node: AstNode) {
    let curr: AstNode | undefined = node;
    while (curr) {
        if (curr.$container && isCollectionPredicate(curr.$container) && curr.$containerProperty === 'right') {
            return curr.$container;
        }
        curr = curr.$container;
    }
    return undefined;
}
