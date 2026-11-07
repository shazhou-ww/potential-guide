export function assertProblemCodes(codes: readonly string[]): void {
  if (
    new Set(codes).size !== codes.length ||
    codes.some((code) => !/^[a-z][a-z0-9-]*$/.test(code) || code.length > 4096)
  )
    throw new Error("Check problem codes must be unique stable names of at most 4096 characters.");
}

export function assertLanguages(languages: readonly string[]): void {
  if (!languages.length || new Set(languages).size !== languages.length)
    throw new Error("Check languages must be nonempty and unique.");
  for (const language of languages) {
    if (Intl.getCanonicalLocales(language)[0] !== language)
      throw new Error(`Noncanonical Check language: ${language}`);
  }
}
