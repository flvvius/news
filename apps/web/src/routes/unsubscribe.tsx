import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/unsubscribe')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/unsubscribe"!</div>
}
