import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { useRouter } from '@tanstack/react-router'

export const ContactUsButton = () => {
  const { t } = useLingui()
  const router = useRouter()

  const handleContactUsClick = () => {
    const currentSearch = router.state.location.search
    void router.navigate({
      to: router.state.location.pathname,
      search: { ...currentSearch, overlay: 'contact-us' },
    })
  }

  return (
    <Button variant='default' onClick={handleContactUsClick}>
      {t`Contact Us`}
    </Button>
  )
}
