import FormControlLabel from '@mui/material/FormControlLabel'
import { styled } from '@mui/material/styles'

const LabelWithHoverEffect = styled(FormControlLabel)(({ theme }) => ({
  '&:hover .MuiSwitch-thumb': {
    outline: `9px solid ${theme.palette.primary.main}29`,
  },
  '&:hover .MuiRadio-colorPrimary': {
    background: `${theme.palette.primary.main}29`,
  },
}))

export default LabelWithHoverEffect
