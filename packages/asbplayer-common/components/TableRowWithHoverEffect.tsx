import TableRow from '@mui/material/TableRow'
import { styled } from '@mui/material/styles'

const TableRowWithHoverEffect = styled(TableRow)(({ theme }) => ({
  '&:hover .MuiIconButton-root': {
    background: `${theme.palette.secondary.main}29`,
  },
  '&:hover': {
    cursor: 'pointer',
  },
}))

export default TableRowWithHoverEffect
