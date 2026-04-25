import Stripe from 'stripe'
import { FEATURES } from '@flicktionary/core/features'
import { getConfig } from '../../../config/environment-config'

export const stripe = FEATURES.STRIPE
  ? new Stripe(getConfig().stripeSecretKey, { apiVersion: '2026-03-25.dahlia' })
  : (null as unknown as Stripe)
