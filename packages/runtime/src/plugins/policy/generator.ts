import { isDataModel, type Model } from '@zenstackhq/language/ast';
import fs from 'node:fs';
import ts from 'typescript';
import type { CliGenerator } from '../../client';

export const generate: CliGenerator = (context) => {
    const source = fs.readFileSync(context.tsSchemaFile, 'utf-8');
    const sourceFile = ts.createSourceFile(
        context.tsSchemaFile,
        source,
        ts.ScriptTarget.Latest,
        true
    );

    const transformer: ts.TransformerFactory<ts.SourceFile> = (
        ctx: ts.TransformationContext
    ) => {
        return (rootNode: ts.SourceFile) => {
            function generateForPlugin(node: ts.PropertyAssignment) {
                const initializer =
                    node.initializer as ts.ObjectLiteralExpression;
                return ts.factory.updatePropertyAssignment(
                    node,
                    node.name,
                    ts.factory.updateObjectLiteralExpression(initializer, [
                        ...initializer.properties,
                        makePolicyProperty(),
                    ])
                );
            }

            function makePolicyProperty(): ts.PropertyAssignment {
                return ts.factory.createPropertyAssignment(
                    'policy',
                    ts.factory.createObjectLiteralExpression([
                        ts.factory.createPropertyAssignment(
                            'authModel',
                            ts.factory.createStringLiteral(
                                getAuthModelName(context.model)
                            )
                        ),
                    ])
                );
            }

            const visitor: ts.Visitor = (node) => {
                if (
                    ts.isPropertyAssignment(node) &&
                    node.name.getText() === 'plugins' &&
                    ts.isObjectLiteralExpression(node.initializer)
                ) {
                    return generateForPlugin(node);
                }
                return ts.visitEachChild(node, visitor, ctx);
            };

            return ts.visitNode(rootNode, visitor) as ts.SourceFile;
        };
    };

    const result = ts.transform(sourceFile, [transformer]);
    const printer = ts.createPrinter();
    const transformedSource = printer.printFile(result.transformed[0]!);
    fs.writeFileSync(context.tsSchemaFile, transformedSource);
};

function getAuthModelName(model: Model) {
    let found = model.declarations.find(
        (d) =>
            isDataModel(d) &&
            d.attributes.some((attr) => attr.decl.$refText === '@@auth')
    );
    if (!found) {
        found = model.declarations.find(
            (d) => isDataModel(d) && d.name === 'User'
        );
    }
    if (!found) {
        throw new Error(
            `@@auth model not found, please add @@auth to your model or create a User model`
        );
    }
    return found.name;
}
