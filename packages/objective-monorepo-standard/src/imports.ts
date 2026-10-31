import ts from "typescript";

export function sourceImports(path: string, content: string) {
  const imports: {
    specifier: string | null;
    typeOnly: boolean;
    localConfiguration?: true;
    nodeWorkerModule?: true;
  }[] = [];
  const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const imported = (name: string, from: string, symbol: string) =>
    file.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === from &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (entry) =>
            entry.name.text === name && (entry.propertyName?.text ?? entry.name.text) === symbol,
        ),
    );
  const localConfiguration = (argument: ts.Expression | undefined) => {
    if (
      !argument ||
      !ts.isPropertyAccessExpression(argument) ||
      argument.name.text !== "href" ||
      !ts.isCallExpression(argument.expression) ||
      argument.expression.arguments.length !== 1 ||
      !ts.isIdentifier(argument.expression.expression) ||
      !imported(argument.expression.expression.text, "node:url", "pathToFileURL")
    )
      return false;
    const path = argument.expression.arguments[0];
    return (
      !!path &&
      ts.isCallExpression(path) &&
      ts.isIdentifier(path.expression) &&
      imported(path.expression.text, "node:path", "resolve") &&
      path.arguments.length > 0
    );
  };
  const nodeWorkerModule = (argument: ts.Expression | undefined) => {
    if (!argument || !ts.isPropertyAccessExpression(argument) || argument.name.text !== "href")
      return false;
    const call = (node: ts.Node, from: string, symbol: string): ts.Expression | undefined =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      imported(node.expression.text, from, symbol) &&
      node.arguments.length === 1
        ? node.arguments[0]
        : undefined;
    const canonical = call(argument.expression, "node:url", "pathToFileURL");
    const file = canonical && call(canonical, "node:fs", "realpathSync");
    const selected = file && call(file, "node:url", "fileURLToPath");
    return (
      !!selected &&
      ts.isPropertyAccessExpression(selected) &&
      selected.name.text === "module" &&
      ts.isIdentifier(selected.expression) &&
      imported(selected.expression.text, "node:worker_threads", "workerData") &&
      imported("parentPort", "node:worker_threads", "parentPort")
    );
  };
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly === true
          : node.isTypeOnly,
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      imports.push({ specifier: node.argument.literal.text, typeOnly: true });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      imports.push({ specifier: node.moduleReference.expression.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        imports.push({ specifier: argument.text, typeOnly: false });
      else
        imports.push({
          specifier: null,
          typeOnly: false,
          ...(node.expression.kind === ts.SyntaxKind.ImportKeyword && localConfiguration(argument)
            ? { localConfiguration: true as const }
            : {}),
          ...(node.expression.kind === ts.SyntaxKind.ImportKeyword && nodeWorkerModule(argument)
            ? { nodeWorkerModule: true as const }
            : {}),
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}
