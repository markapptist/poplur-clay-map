import { useEffect, type RefObject } from 'react'
import { postNativeEvent } from './nativeBridge'
import { nativeMapRendererEnabled } from './nativeMapMode'

const SELECTOR = 'button,input,textarea,select,[role="slider"],[role="dialog"],[data-poplur-cube],[data-poplur-channel-arrows],[data-poplur-control-rail],[data-poplur-native-hit-region],[data-poplur-gesture-navigation]'

/** The real controls keep ownership of their native touch rectangles. Map
 * gestures pass through everywhere else, with no replacement UI/zoom rail. */
export function useNativeMapPresentation(frame: RefObject<HTMLIFrameElement>, active: boolean, blocked: boolean) {
  useEffect(() => {
    if (!nativeMapRendererEnabled()) return
    const iframe = frame.current
    let disposed = false, timer: number | null = null, signature = ''
    const observers: Array<MutationObserver | ResizeObserver> = []
    const transparent = new Set<HTMLElement>()
    const observedDocuments = new Set<Document>()
    const markGrounds = (element: HTMLElement | null) => {
      for (let node = element; node; node = node.parentElement) {
        node.dataset.poplurNativeMapGround = ''; transparent.add(node)
      }
    }
    const publish = () => {
      timer = null
      if (disposed) return
      const regions: Array<{x:number;y:number;width:number;height:number}> = []
      const collect = (doc: Document, offsetX = 0, offsetY = 0) => {
        for (const element of doc.querySelectorAll<HTMLElement>(SELECTOR)) {
          const style = doc.defaultView!.getComputedStyle(element)
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) <= .01) continue
          // Opacity is not inherited; an immersive rail can hide its still-
          // opaque buttons. Check ancestors without watching per-pin transforms.
          let hidden = false
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const p = doc.defaultView!.getComputedStyle(parent)
            if (p.display === 'none' || p.visibility === 'hidden' || Number(p.opacity) <= .01) { hidden=true; break }
          }
          if (hidden) continue
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          regions.push({x:rect.x+offsetX-3,y:rect.y+offsetY-3,width:rect.width+6,height:rect.height+6})
        }
      }
      if (active && !blocked) {
        collect(document)
        if (iframe?.contentDocument) { const rect=iframe.getBoundingClientRect(); collect(iframe.contentDocument,rect.x,rect.y) }
      }
      const payload = {type:'nativeMapPresentation',renderer:'mapbox',active,passthrough:active&&!blocked,
        viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,viewportOffsetX:0,viewportOffsetY:0,regions}
      const next = JSON.stringify(payload)
      if (next !== signature) { signature=next; postNativeEvent(payload) }
    }
    const schedule = () => { if (timer == null && !disposed) timer=window.setTimeout(publish,50) }
    const observe = (doc: Document) => {
      if (observedDocuments.has(doc)) return
      observedDocuments.add(doc)
      doc.addEventListener('transitionend',schedule,true)
      const mutation=new MutationObserver(schedule)
      mutation.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-hidden','aria-expanded']})
      observers.push(mutation)
      const resize=new ResizeObserver(schedule)
      for (const element of doc.querySelectorAll(SELECTOR)) resize.observe(element)
      observers.push(resize)
    }
    const loaded = () => {
      if (!active || !iframe?.contentDocument) return
      markGrounds(iframe); observe(iframe.contentDocument); schedule()
    }
    const settled = (event: Event) => { if (['idle','touchend'].includes((event as CustomEvent).detail?.event)) schedule() }
    if (active) { if(iframe)markGrounds(iframe); observe(document); loaded() }
    iframe?.addEventListener('load',loaded)
    window.addEventListener('resize',schedule)
    window.addEventListener('poplur-native-map-event',settled)
    publish()
    return () => {
      disposed=true; if(timer!=null)clearTimeout(timer)
      for(const observer of observers)observer.disconnect()
      iframe?.removeEventListener('load',loaded); window.removeEventListener('resize',schedule)
      window.removeEventListener('poplur-native-map-event',settled)
      for (const doc of observedDocuments) doc.removeEventListener('transitionend',schedule,true)
      for(const element of transparent)delete element.dataset.poplurNativeMapGround
      postNativeEvent({type:'nativeMapPresentation',renderer:'mapbox',active:false,passthrough:false,regions:[]})
    }
  },[frame,active,blocked])
}
