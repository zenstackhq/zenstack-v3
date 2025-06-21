import type { ValidationAcceptor } from 'langium';
import { FunctionDecl } from '../generated/ast';
import { validateAttributeApplication } from './attribute-application-validator';
import type { AstValidator } from './common';

/**
 * Validates function declarations.
 */
export default class FunctionDeclValidator implements AstValidator<FunctionDecl> {
    validate(funcDecl: FunctionDecl, accept: ValidationAcceptor) {
        funcDecl.attributes.forEach((attr) => validateAttributeApplication(attr, accept));
    }
}
