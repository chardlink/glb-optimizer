import DesktopApp from './DesktopApp'
import WebApp from './WebApp'

export default function App() {
  return window.desktopBridge?.isDesktop ? <DesktopApp /> : <WebApp />
}
