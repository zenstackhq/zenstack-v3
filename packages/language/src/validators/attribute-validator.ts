import type { ValidationAcceptor } from 'langium';
import { Attribute } from '../generated/ast';
import { validateAttributeApplication } from './attribute-application-validator';
import type { AstValidator } from './common';

/**
 * Validates attribute declarations.
 */
export default class AttributeValidator implements AstValidator<Attribute> {
    validate(attr: Attribute, accept: ValidationAcceptor): void {
        attr.attributes.forEach((attr) => validateAttributeApplication(attr, accept));
    }
}
