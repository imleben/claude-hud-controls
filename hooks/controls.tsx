import type { ClientModule } from 'claude-code'

/** One run of the controls row; a run with a `key` is pressed by a click on it. */
export type Segment = {
  key: string | null
  label: string
  color: string | null
  isBold: boolean
  /** Its command waits in the engine's queue for the turn to end. */
  isPending: boolean
}

type Placed = Segment & { x: number }

// Runs go left to right, one space apart, onto as many rows as the width needs.
function place(segments: readonly Segment[], columns: number) {
  const rows: Placed[][] = [[]]
  let end = 0
  for (const one of segments) {
    let row = rows[rows.length - 1] ?? []
    if (row.length > 0 && columns > 0 && end + 1 + one.label.length > columns) {
      row = []
      rows.push(row)
    }
    const x = row.length === 0 ? 0 : end + 1
    row.push({ ...one, x })
    end = x + one.label.length
  }
  return rows
}

// A post replaces one not yet delivered in its frame, so a tick before the next
// redraw stays quiet rather than stand in for a press.
let hasPressed = false

// Drawn without Buttons so the pointer never inverts a run: clicks are mapped
// to runs here and posted to the hooks module as `{ press: key, isWorking }`.
const Controls: ClientModule<{ segments: Segment[]; isWorking: boolean }, true> = (
  props,
  surface,
) => {
  const { Box, Text } = surface.elements
  const rows = place(props.segments, surface.columns)
  hasPressed = false

  if (surface.state === undefined) {
    surface.setState(true)
    // Once a second the hooks module reads what the HUD statusline last heard.
    surface.every(1000, () => {
      if (!hasPressed) surface.post({ sync: true })
      hasPressed = false
    })
  }

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    const hit = rows[event.y]?.find(
      one => one.key !== null && event.x >= one.x && event.x < one.x + one.label.length,
    )
    if (!hit?.key) return
    hasPressed = true
    surface.post({ press: hit.key, isWorking: props.isWorking })
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, y) => (
        <Box key={`row:${y}`}>
          <Text>
            {row.flatMap((one, at) => [
              at === 0 ? '' : ' ',
              one.color === null ? (
                <Text dimColor>{one.label}</Text>
              ) : (
                <Text
                  color={one.color}
                  weight={one.isBold ? 'bold' : 'regular'}
                  underline={one.isPending}
                >
                  {one.label}
                </Text>
              ),
            ])}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export default Controls
