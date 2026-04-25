import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'

describe('contact-email-router', async () => {
  const testApp = buildTestApp()
  const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  test('should send contact email successfully', async () => {
    const validData = {
      username: 'John Doe',
      email: 'sebastien.stecker@gmail.com',
      message: 'Hello, this is a test message.',
    }

    const response = await request(testApp)
      .post('/api/v1/send-contact-email')
      .send(validData)
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
    expect(response.body.data).toStrictEqual({
      message: 'Email sent successfully',
    })
  })

  test('should return 400 for invalid request body', async () => {
    const invalidData = {
      username: 'John Doe',
      email: 'invalid-email',
      message: 'Hello, this is a test message.',
    }

    const response = await request(testApp)
      .post('/api/v1/send-contact-email')
      .send(invalidData)
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(400)
    expect(response.body.data).toHaveProperty('issues')
    expect(response.body.data.issues[0].message).toEqual('Please enter a valid email address.')
  })
})
