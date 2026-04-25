import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { importJWK, SignJWT } from 'jose'
import { getConfig } from '../config/environment-config'
import { SupabaseClaims } from '../middleware/token-authentication-middleware'
import fs from 'fs/promises'

type CryptoKey = Awaited<ReturnType<typeof importJWK>>

let jwksClientInstance: jwksClient.JwksClient | null = null

const getJwksClient = (): jwksClient.JwksClient => {
  if (!jwksClientInstance) {
    const config = getConfig()
    jwksClientInstance = jwksClient({
      jwksUri: config.supabaseJwksUri,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes (matches Supabase Edge cache)
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    })
  }
  return jwksClientInstance
}

/**
 * Function to get signing key for asymmetric JWT verification (JWKS)
 * This is used as a callback for jwt.verify() when using JWKS
 */
const getSigningKey = (
  header: jwt.JwtHeader,
  callback: (err: Error | null, signingKey?: string | undefined) => void
): void => {
  const client = getJwksClient()
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err)
      return
    }
    const signingKey = key?.getPublicKey()
    callback(null, signingKey)
  })
}

/**
 * Verifies a JWT token using asymmetric (JWKS) verification
 * Based on the environment configuration
 *
 * @param token - The JWT token to verify
 * @returns Promise resolving to the decoded SupabaseClaims
 * @throws Error if token verification fails
 */
export const verifySupabaseToken = (token: string): Promise<SupabaseClaims> => {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256', 'ES256'], // Supabase supports both RSA and ECDSA
      },
      (err, decoded) => {
        if (err) {
          reject(err)
          return
        }
        resolve(decoded as SupabaseClaims)
      }
    )
    return
  })
}

// Cache for the private key to avoid reading the file multiple times
let cachedPrivateKey: { key: CryptoKey; kid: string } | null = null

/**
 * Reads the private key from signing_key.json file
 * The file should contain an array of JWK objects (as required by Supabase)
 */
const getPrivateKeyFromFile = async (signingKeyPath: string): Promise<{ key: CryptoKey; kid: string }> => {
  if (cachedPrivateKey) {
    return cachedPrivateKey
  }

  const fileContent = await fs.readFile(signingKeyPath, 'utf-8')
  const keys = JSON.parse(fileContent)

  // The file should be an array of JWKs
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('signing_key.json must contain an array with at least one key')
  }

  const jwk = keys[0]

  // Remove key_ops or set it to ["sign"] for signing
  // The jose library is strict about key usage
  const jwkForSigning = {
    ...jwk,
    key_ops: ['sign'],
  }

  const privateKey = await importJWK(jwkForSigning, jwk.alg)

  cachedPrivateKey = { key: privateKey, kid: jwk.kid }
  return cachedPrivateKey
}

/**
 * Signs a JWT token using the private key from signing_key.json (asymmetric ES256)
 * Used in tests to generate valid JWTs that can be verified by the JWKS endpoint
 *
 * @param claims - The claims to include in the JWT (sub, user_metadata)
 * @param signingKeyPath - Path to signing_key.json file containing the private key
 * @returns The signed JWT token (valid for 1 hour)
 * @throws Error if the signing key cannot be read or signing fails
 */
export const signSupabaseToken = async (claims: SupabaseClaims, signingKeyPath: string): Promise<string> => {
  try {
    const { key, kid } = await getPrivateKeyFromFile(signingKeyPath)

    const expiresInSeconds = 3600 // 1h

    const token = await new SignJWT({
      sub: claims.sub,
      user_metadata: claims.user_metadata,
    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .sign(key)

    return token
  } catch (error) {
    throw new Error(`Failed to sign token with private key: ${error}`)
  }
}
