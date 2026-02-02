import type { CliPlugin } from '@zenstackhq/sdk'
import { isDataField, isDataModel } from '@zenstackhq/sdk/ast'
import fs from 'node:fs'

const initialOutput = `// Generated types
import type { Required } from 'utility-types'

import type {
  __models__
} from './models'
`

const cliPlugin: CliPlugin = {
  name: 'Generate Types',

  generate: ({ model, defaultOutputPath, pluginOptions }) => {
    console.log('\n🚧 Generate Types Plugin')
    if (pluginOptions.report !== true) {
      return
    }

    let output = initialOutput
    const models: string[] = []
    const modelDeclarations = model.declarations
      .filter(isDataModel)
      .slice() // make a shallow copy to avoid mutating the original
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const dm of modelDeclarations) {
      const references: Array<{ referenceName: string, referenceModelName: string, isArray: boolean }> = []
      models.push(dm.name)

      for (const field of dm.fields) {
        if (isDataField(field) && field.type?.reference?.ref?.$type === 'DataModel') {
          references.push({
            referenceName: field.name,
            referenceModelName: field.type.reference?.ref?.name ?? '',
            isArray: field.type.array,
          })
        }
      }

      output += `\nexport type ${dm.name}Full = Required<Partial<${dm.name}>, 'id'> & {${references.map(reference => `\n  ${reference.referenceName}?: Required<Partial<${reference.referenceModelName}Full>, 'id'>${reference.isArray ? '[]' : ''}`).join('')}\n}\n`
    }

    output = output.replace('__models__', `${models.join(',\n  ')},`)

    fs.writeFileSync(
      `${defaultOutputPath}/inferred-types.ts`,
      output,
      'utf-8',
    )
  },
}

export default cliPlugin
