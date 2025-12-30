import type { ValidationAcceptor } from 'langium';
import type { Procedure, ProcedureParam } from '../generated/ast';
import { validateAttributeApplication } from './attribute-application-validator';
import type { AstValidator } from './common';

const RESERVED_PROCEDURE_NAMES = new Set([
    // avoid prototype pollution / surprising JS behavior
    '__proto__',
    'prototype',
    'constructor',
]);

/**
 * Validates procedure declarations.
 */
export default class ProcedureValidator implements AstValidator<Procedure> {
    validate(proc: Procedure, accept: ValidationAcceptor): void {
        this.validateName(proc, accept);
        this.validateParams(proc, accept);
        this.validateReturnType(proc, accept);
        proc.attributes.forEach((attr) => validateAttributeApplication(attr, accept));
    }

    private validateName(proc: Procedure, accept: ValidationAcceptor): void {
        if (RESERVED_PROCEDURE_NAMES.has(proc.name)) {
            accept('error', `Procedure name "${proc.name}" is reserved`, {
                node: proc,
                property: 'name',
            });
        }
    }

    private validateParams(proc: Procedure, accept: ValidationAcceptor): void {
        proc.params.forEach((param) => this.validateParamType(param, accept));
    }

    private validateParamType(param: ProcedureParam, accept: ValidationAcceptor): void {
        const typeRef = param.type.reference;
        if (typeRef && !typeRef.ref) {
            accept('error', `Unknown type "${typeRef.$refText}"`, {
                node: param.type,
                property: 'reference',
            });
        }
    }

    private validateReturnType(proc: Procedure, accept: ValidationAcceptor): void {
        const typeRef = proc.returnType.reference;
        if (typeRef && !typeRef.ref) {
            accept('error', `Unknown type "${typeRef.$refText}"`, {
                node: proc.returnType,
                property: 'reference',
            });
        }
    }
}
