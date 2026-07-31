export function isMacOsProtectedUserPath(path: string, userHome: string): boolean {
  const root = userHome.replace(/\/$/, "")
  return ["Desktop", "Documents", "Downloads"]
    .map((name) => `${root}/${name}`)
    .some((protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`))
}
