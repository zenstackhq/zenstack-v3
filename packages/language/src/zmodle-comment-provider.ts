import { DefaultCommentProvider, type AstNode } from 'langium';
import { match } from 'ts-pattern';
import { isDataField, isDataModel, isEnum, isEnumField, isFunctionDecl, isTypeDef } from './ast';

export class ZModelCommentProvider extends DefaultCommentProvider {
    override getComment(node: AstNode): string | undefined {
        let comment = super.getComment(node);
        if (!comment) {
            // default comment
            comment = match(node)
                .when(isDataModel, (d) => `/**\n * Model *${d.name}*\n */`)
                .when(isTypeDef, (d) => `/**\n * Type *${d.name}*\n */`)
                .when(isEnum, (e) => `/**\n * Enum *${e.name}*\n */`)
                .when(isEnumField, (f) => `/**\n * Value of enum *${f.$container?.name}*\n */`)
                .when(isDataField, (f) => `/**\n * Field of *${f.$container?.name}*\n */`)
                .when(isFunctionDecl, (f) => `/**\n * Function *${f.name}*\n */`)
                .otherwise(() => '');
        }
        return comment;
    }
}
