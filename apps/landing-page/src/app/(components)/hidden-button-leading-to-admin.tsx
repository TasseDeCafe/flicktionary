import Link from 'next/link'

// our current convention is to put it in the bottom left of the page, the button's parent(s) should be positioned
// relative to make it happen
const HiddenButtonLeadingToAdmin = () => {
  return (
    <Link href='/yba-admin' className='absolute bottom-0 left-0 h-32 w-8 cursor-pointer opacity-0' aria-hidden='true' />
  )
}

export default HiddenButtonLeadingToAdmin
