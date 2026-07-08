import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbTeacherProfile = Tables<'teacher_profiles'>

const listForUser = async (userId: string): Promise<DbTeacherProfile[]> => {
  return (await sql`
    SELECT * FROM public.teacher_profiles
    WHERE user_id = ${userId}
    ORDER BY name ASC
  `) as DbTeacherProfile[]
}

const findByIdForUser = async (id: string, userId: string): Promise<DbTeacherProfile | null> => {
  const result = (await sql`
    SELECT * FROM public.teacher_profiles
    WHERE id = ${id} AND user_id = ${userId}
  `) as DbTeacherProfile[]
  return result[0] ?? null
}

// Name is the user-facing identity ("Yulia", "italki teacher 2"); re-saving
// under the same name updates the profile text in place.
const upsert = async (params: {
  userId: string
  name: string
  language: string
  profileText: string
}): Promise<DbTeacherProfile> => {
  const result = (await sql`
    INSERT INTO public.teacher_profiles (user_id, name, language, profile_text)
    VALUES (${params.userId}, ${params.name}, ${params.language}, ${params.profileText})
    ON CONFLICT (user_id, name) DO UPDATE
    SET language = EXCLUDED.language,
        profile_text = EXCLUDED.profile_text,
        updated_at = NOW()
    RETURNING *
  `) as DbTeacherProfile[]
  return result[0]!
}

export interface TeacherProfilesRepositoryInterface {
  listForUser: (userId: string) => Promise<DbTeacherProfile[]>
  findByIdForUser: (id: string, userId: string) => Promise<DbTeacherProfile | null>
  upsert: (params: { userId: string; name: string; language: string; profileText: string }) => Promise<DbTeacherProfile>
}

export const TeacherProfilesRepository = (): TeacherProfilesRepositoryInterface => ({
  listForUser,
  findByIdForUser,
  upsert,
})
