export interface TryOnModel {
  label: string
  file: string
  family: string
  color: string
  colorClass: string
}

export function getTryOnModel(
  models: TryOnModel[],
  file: string | undefined
): TryOnModel | undefined {
  if (!file) return undefined
  return models.find((m) => m.file === file)
}

export interface TryOnModelFamily {
  family: string
  displayName: string
  models: TryOnModel[]
}

export function getTryOnModelFamilies(
  models: TryOnModel[]
): TryOnModelFamily[] {
  const map = new Map<string, TryOnModel[]>()
  for (const model of models) {
    const list = map.get(model.family) ?? []
    list.push(model)
    map.set(model.family, list)
  }

  return Array.from(map.entries()).map(([family, familyModels]) => ({
    family,
    displayName: family.charAt(0).toUpperCase() + family.slice(1),
    models: familyModels
  }))
}
