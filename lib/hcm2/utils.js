const interpret_si_prefix = (si_number) => (
  si_number.match(/^[1-9][0-9]*K*$/) ?
    si_number.replaceAll('K', "000") :
    si_number
)

module.exports = {
    interpret_si_prefix,
}
