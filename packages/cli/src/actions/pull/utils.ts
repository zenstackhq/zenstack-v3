import type { ZModelServices } from '@zenstackhq/language'
import {
  DataField,
  EnumField,
  isInvocationExpr,
  type AbstractDeclaration,
  type Attribute,
  type Model,
} from '@zenstackhq/language/ast'
import { getStringLiteral } from '@zenstackhq/language/utils'
import type {
  DataSourceProviderType
} from '@zenstackhq/sdk/schema'
import type { Reference } from 'langium'

export function getAttribute(model: Model, attrName: string) {
  const references = model.$document!
    .references as Reference<AbstractDeclaration>[]
  return references.find(
    (a) => a.ref!.$type === 'Attribute' && a.ref!.name === attrName
  )?.ref as Attribute | undefined
}

export function getDatasource(model: Model) {
  const datasource = model.declarations.find((d) => d.$type === 'DataSource')
  if (!datasource) {
    throw new Error('No datasource declaration found in the schema.')
  }

  const urlField = datasource.fields.find((f) => f.name === 'url')!
  let url = getStringLiteral(urlField.value)

  if (!url && isInvocationExpr(urlField.value)) {
    url = process.env[getStringLiteral(urlField.value.args[0]) as string]!
  }

  if (!url) {
    throw new Error('The url field must be a string literal or an env().')
  }

  return {
    name: datasource.name,
    provider: getStringLiteral(
      datasource.fields.find((f) => f.name === 'provider')?.value
    ) as DataSourceProviderType,
    url,
  }
}

export function getDbName(
  decl: AbstractDeclaration | DataField | EnumField
): string {
  if (!('attributes' in decl)) return decl.name
  const nameAttr = decl.attributes.find(
    (a) => a.decl.ref?.name === '@@map' || a.decl.ref?.name === '@map'
  )
  if (!nameAttr) return decl.name
  const attrValue = nameAttr.args[0]?.value

  if (attrValue?.$type !== 'StringLiteral') return decl.name

  return attrValue.value
}

export function getAttributeRef(name: string, services: ZModelServices) {
  return services.shared.workspace.IndexManager.allElements("Attribute").find(a => a.name === name) as Attribute | undefined
}