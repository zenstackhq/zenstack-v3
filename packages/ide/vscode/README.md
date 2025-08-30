# ZenStack V3 VS Code Extension

[ZenStack](https://zenstack.dev) is the modern data layer for TypeScript applications. It provides a data modeling language, a type-safe ORM with built-in access control, and other utilities that help you streamline full-stack development. This VS Code extension provides code editing helpers for authoring ZenStack's schema files (`.zmodel` files).

Use this extension if you are using ZenStack v3.x, otherwise use the [original extension](https://marketplace.visualstudio.com/items?itemName=zenstack.zenstack) that works with v2.x. See [Configuration](#configuration) for how to use both versions side by side.

## Features

- Syntax highlighting
- Inline error reporting
- Go-to definition
- Hover documentation
- Code section folding

## Configuration

### Side by side with the original ZenStack extension

If you have the [original ZenStack v2 extension](https://marketplace.visualstudio.com/items?itemName=zenstack.zenstack) installed, it may compete with this extension on handling `.zmodel` files. In this case, add the following settings to your `.vscode/settings.json` file to specify which extension should handle `.zmodel` files.

To let this extension handle `.zmodel` files, add:

```json
"files.associations": {
    "*.zmodel": "zmodel-v3"
},
```

To let the v2 extension handle `.zmodel` files, add:

```json
"files.associations": {
    "*.zmodel": "zmodel"
},
```

### Auto formatting

To automatically format on save, add the following to your `.vscode/settings.json` file:

```json
"editor.formatOnSave": true
```

To enable formatting in combination with prettier, add the following to your `.vscode/settings.json` file:

```json
"[zmodel-v3]": {
    "editor.defaultFormatter": "zenstack.zenstack-v3"
},
```

## Links

- [Home](https://zenstack.dev/v3)
- [Documentation](https://zenstack.dev/docs/3.x)
- [Community chat](https://discord.gg/Ykhr738dUe)
- [Twitter](https://twitter.com/zenstackhq)
- [Blog](https://zenstack.dev/blog)

## Community

Join our [discord server](https://discord.gg/Ykhr738dUe) for chat and updates!

## License

[MIT](https://github.com/zenstackhq/zenstack/blob/main/LICENSE)
