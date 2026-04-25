import Constants from 'expo-constants'

/**
 * Parses a version string in the format "x.y.z" to an array of numbers
 */
const parseVersion = (version: string): number[] => {
  return version.split('.').map(Number)
}

/**
 * Compares two version strings in the format "x.y.z"
 * @returns
 *  1 if version1 is greater than version2
 *  0 if version1 is equal to version2
 * -1 if version1 is less than version2
 */
export const compareVersions = (version1: string, version2: string): number => {
  const v1Parts = parseVersion(version1)
  const v2Parts = parseVersion(version2)

  // Compare each component of the version
  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    // If a component doesn't exist, treat it as 0
    const v1Component = v1Parts[i] || 0
    const v2Component = v2Parts[i] || 0

    if (v1Component > v2Component) {
      return 1
    }
    if (v1Component < v2Component) {
      return -1
    }
  }

  // Versions are equal
  return 0
}

/**
 * Checks if a version requires an update compared to the minimum required version
 * @returns true if an update is required, false otherwise
 */
export const requiresUpdate = (currentVersion: string, minRequiredVersion: string): boolean => {
  return compareVersions(currentVersion, minRequiredVersion) < 0
}

/**
 * Gets the version from the app config
 * Uses Constants.expoConfig.version from expo-constants
 */
export const getAppVersion = (): string => {
  try {
    // Handle possible null/undefined values
    return Constants.expoConfig?.version || '0.0.0'
  } catch (error) {
    console.error('Error getting app version:', error)
    return '0.0.0' // Fallback version
  }
}
