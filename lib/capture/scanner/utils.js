const ignoreSharpError = processedFrame =>
  processedFrame
    .catch(err => {
      console.log("Error processing frame:", err)
      return null
    })

module.exports = {
  ignoreSharpError,
}
