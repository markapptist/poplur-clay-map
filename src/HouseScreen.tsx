import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { studioInitialCharacter } from './AvatarStudioCharacter'
import { onCharacterChange, readCharacter, type PoplurCharacter } from './characterStore'
import { readSavedAvaturnAvatar, resolveSavedAvaturnAvatarUrl } from './avaturnAvatarStore'
import { accountSnapshot } from './accountStore'
import { type HouseGuest, normalizeHouseGuests, previewHouseGuests } from './houseGuests'
import { createPoplurAvatarRuntime, type PoplurAvatarHandle } from './ThreeAvatarStudio'
import { type PoplurAvatarMotion } from './avatarMotion'
import { createExternalAvatarMotion, type ExternalAvatarMotionHandle } from './externalAvatarMotion'
import { onFrame } from './frameGovernor'
import {
  HOUSE_ACTIVITIES,
  houseMood,
  moveHouseAvatar,
  performHouseActivity,
  readHouseLife,
  saveHouseLife,
  type HouseActivityId,
  type HouseLifeState,
} from './houseLife'
import { isNativeShell } from './nativeBridge'
import { useNearbyLocation } from './nearbyLocation'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { releaseWebGL } from './threeCleanup'
import { loadWardrobeCatalog, type RemoteWardrobeStyles } from './wardrobeGarmentApi'
import { callState, hangup, placeCall, subscribeCall, toggleMute, type CallSnapshot } from './webCall'
import { playPop } from './pop'
import styles from './HouseScreen.module.css'

let houseRendererSequence = 0
let houseGuestRequestSequence = 0

type HouseRuntime = {
  moveTo: (x: number, z: number, activity?: HouseActivityId | 'idle') => void
  setGuest: (guest: Pick<HouseGuest, 'id' | 'name'> | null) => void
  render: () => void
}

function houseHostName() {
  const account = accountSnapshot()
  const value = account.username ?? account.displayName ?? 'Poplur friend'
  return value.startsWith('@') ? value : `@${value}`
}

function readWardrobeProvider(): 'avaturn' | 'poplur' {
  try {
    return localStorage.getItem('poplur.wardrobe.provider.v1') === 'avaturn'
      && readSavedAvaturnAvatar()
      ? 'avaturn'
      : 'poplur'
  } catch { return 'poplur' }
}

function guestPalette(id: string) {
  let hash = 0
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  const colors = ['#62d8cf', '#ffcf58', '#8fcf6a', '#75b7ff', '#c38cff']
  return colors[Math.abs(hash) % colors.length]
}

function clay(color: string, roughness = .72) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: .015 })
}

function addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: string, rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), clay(color))
  mesh.position.set(...position)
  mesh.rotation.y = rotationY
  parent.add(mesh)
  return mesh
}

function addCylinder(parent: THREE.Object3D, radius: number, height: number, position: [number, number, number], color: string, radialSegments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), clay(color))
  mesh.position.set(...position)
  parent.add(mesh)
  return mesh
}

const MANSION_SCALE = { x: 1.9, z: 1.7 } as const
const MANSION_WALK_BOUNDS = { x: 5.42, z: 4 } as const

function toMansionPosition(x: number, z: number) {
  return { x: x * MANSION_SCALE.x, z: z * MANSION_SCALE.z }
}

function addRug(parent: THREE.Object3D, radius: number, position: [number, number], color: string, scaleZ = .7) {
  const rug = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), clay(color))
  rug.rotation.x = -Math.PI / 2
  rug.scale.y = scaleZ
  rug.position.set(position[0], .045, position[1])
  parent.add(rug)
  return rug
}

function buildRoom(scene: THREE.Scene) {
  const room = new THREE.Group()
  scene.add(room)
  // A single low-poly estate shell replaces the old tiled studio room. The
  // coloured floor inlays make six spaces readable even on a narrow phone.
  addBox(room, [12.8, .12, 8.8], [0, -.07, 0], '#f7dce8')
  addBox(room, [2.75, .035, 5.8], [0, .012, .45], '#fff5f9') // grand foyer
  addBox(room, [4.65, .035, 3.75], [-4, .014, -2.35], '#ebc0d5') // bedroom suite
  addBox(room, [4.65, .035, 3.75], [4, .014, -2.35], '#d9caef') // lounge
  addBox(room, [5.15, .035, 4.15], [-3.75, .016, 2.25], '#f3c8d2') // kitchen + dining
  addBox(room, [5.15, .035, 4.15], [3.75, .016, 2.25], '#ead1ef') // ballroom
  addBox(room, [.08, .045, 8.5], [-1.42, .025, 0], '#d79aae')
  addBox(room, [.08, .045, 8.5], [1.42, .025, 0], '#d79aae')

  // Open dollhouse walls, moulding and large estate windows.
  addBox(room, [12.95, 3.2, .14], [0, 1.55, -4.48], '#f7a9ca')
  addBox(room, [.14, 3.2, 8.95], [-6.48, 1.55, 0], '#ed84b4')
  addBox(room, [12.65, .12, .1], [0, .72, -4.37], '#fff3f8')
  addBox(room, [.1, .12, 8.65], [-6.37, .72, 0], '#fff3f8')
  for (const x of [-4.25, 4.25]) {
    addBox(room, [2.45, 1.48, .06], [x, 1.98, -4.37], '#fff8fc')
    addBox(room, [2.24, 1.28, .07], [x, 1.98, -4.28], '#7bc4e2')
    addBox(room, [.08, 1.3, .08], [x, 1.98, -4.22], '#fff8fc')
  }
  addBox(room, [.07, 1.5, 2.35], [-6.36, 1.92, 1.7], '#fff8fc')
  addBox(room, [.08, 1.3, 2.15], [-6.27, 1.92, 1.7], '#7bc4e2')

  // Grand staircase and entry colonnade establish the mansion scale.
  for (let step = 0; step < 6; step += 1) {
    addBox(room, [2.55 - step * .16, .14 + step * .12, .48], [0, .07 + step * .06, -3.66 + step * .43], step % 2 ? '#f7d8e6' : '#fff5fa')
  }
  addBox(room, [3.2, .12, .46], [0, .72, -1.34], '#b65887')
  for (const x of [-1.22, 1.22]) {
    addCylinder(room, .14, 1.82, [x, .91, 3.72], '#fff5f8', 12)
    addCylinder(room, .22, .1, [x, 1.82, 3.72], '#d780ab', 12)
  }
  addBox(room, [4.6, .1, .62], [0, .01, 4.58], '#ecd2dc')
  addBox(room, [3.35, .12, .48], [0, -.02, 5.07], '#d7adbf')

  // Master bedroom suite. The activity target lands at the foot of the bed.
  addBox(room, [2.75, .28, 1.55], [-4.45, .24, -3.18], '#fff8fb')
  addBox(room, [2.75, .16, .55], [-4.45, .46, -3.62], '#ffffff')
  addBox(room, [2.75, .13, .56], [-4.45, .44, -2.72], '#ff69ad')
  addBox(room, [.18, 1.28, 1.65], [-5.75, .64, -3.18], '#9c326a')
  addBox(room, [.78, .68, .62], [-2.65, .34, -3.46], '#c66b98')
  addRug(room, 1.15, [-3.9, -1.75], '#d55291', .56)

  // Lounge with a sectional, coffee table and sculptural lamp.
  addBox(room, [2.65, .48, .82], [4.24, .29, -3.22], '#765bc2')
  addBox(room, [2.65, .76, .22], [4.24, .65, -3.56], '#8e72dc')
  addBox(room, [.3, .68, .88], [2.82, .5, -3.22], '#6846ae')
  addBox(room, [1.15, .18, .72], [4.15, .18, -1.82], '#ffd875')
  addCylinder(room, .08, 1.2, [5.72, .6, -1.7], '#64234e', 12)
  const shade = new THREE.Mesh(new THREE.ConeGeometry(.34, .52, 16, 1, true), clay('#ffdd68'))
  shade.position.set(5.72, 1.28, -1.7)
  room.add(shade)
  addRug(room, 1.35, [4.18, -2.28], '#b89be4', .6)

  // Chef kitchen and a dining table for House guests.
  addBox(room, [3.15, .86, .66], [-4.62, .43, 3.55], '#d95a94')
  addBox(room, [3.24, .08, .75], [-4.62, .9, 3.55], '#fff8fb')
  addBox(room, [.82, 1.72, .72], [-5.75, .86, 2.15], '#bde0e9')
  addBox(room, [1.65, .82, .75], [-3.88, .42, 1.43], '#e77ba8')
  addCylinder(room, .9, .13, [-2.2, .72, 2.46], '#ffdc78', 20)
  addCylinder(room, .12, .67, [-2.2, .35, 2.46], '#9c4b74', 12)
  for (const offset of [-1, 1]) addBox(room, [.64, .52, .64], [-2.2 + offset * 1.12, .27, 2.46], '#ef8fba', offset * .16)

  // Entertainment ballroom with a dance medallion and small grand piano.
  addRug(room, 1.58, [2.2, 2.08], '#ee4e9f', .74)
  addCylinder(room, .28, .08, [2.2, .075, 2.08], '#ffd769', 20)
  addBox(room, [1.7, .68, 1.05], [4.7, .46, 2.9], '#42223f', -.28)
  addBox(room, [1.35, .12, .72], [4.5, .83, 2.7], '#6b345c', -.28)
  for (const x of [4.15, 5.15]) addCylinder(room, .07, .72, [x, .36, 3.18], '#35172f', 10)

  // Terrace fountain and clipped topiary keep the front edge feeling lived in.
  addCylinder(room, .76, .18, [0, .08, 4.03], '#b87aa0', 20)
  addCylinder(room, .48, .16, [0, .22, 4.03], '#76cbe1', 20)
  for (const x of [-5.62, 5.62]) {
    addCylinder(room, .38, .42, [x, .21, 3.84], '#aa4f7c', 14)
    const topiary = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 8), clay('#5b9c62'))
    topiary.scale.set(.78, 1.32, .78)
    topiary.position.set(x, .93, 3.84)
    room.add(topiary)
  }
  return room
}

function buildAvatar(character: PoplurCharacter) {
  const avatar = new THREE.Group()
  const skin = character.skinTone || '#C98B62'
  const hair = character.hairColor || '#2C2C2A'
  const top = character.topColor || '#D4537E'
  const bottoms = character.bottomColor || '#185FA5'
  const bodyWidth = character.bodyShape === 'curvy' ? 1.12 : character.bodyShape === 'athletic' ? 1.08 : .94
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.33, 24), new THREE.MeshBasicMaterial({ color: '#48132f', transparent: true, opacity: .25, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = .01
  avatar.add(shadow)
  for (const side of [-1, 1]) {
    const leg = addCylinder(avatar, .105, .48, [side * .14, .31, 0], bottoms, 12)
    leg.userData.walkingLimb = side
    addBox(avatar, [.24, .12, .36], [side * .14, .08, .08], '#f7eef4')
    const arm = addCylinder(avatar, .085, .52, [side * .39 * bodyWidth, .9, 0], skin, 12)
    arm.rotation.z = side * -.12
    arm.userData.walkingLimb = -side
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.3 * bodyWidth, .42, 5, 12), clay(top))
  torso.position.y = .92
  avatar.add(torso)
  addCylinder(avatar, .085, .13, [0, 1.31, 0], skin, 12)
  const head = new THREE.Mesh(new THREE.SphereGeometry(.285, 20, 14), clay(skin))
  head.position.y = 1.55
  avatar.add(head)
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(.298, 18, 12), clay(hair))
  hairCap.scale.set(1.02, character.hairStyle === 'buzz' ? .56 : .72, 1.02)
  hairCap.position.set(0, character.hairStyle === 'buzz' ? 1.68 : 1.73, -.02)
  avatar.add(hairCap)
  if (character.hairStyle === 'long' || character.hairStyle === 'curly') {
    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.SphereGeometry(.14, 14, 10), clay(hair))
      lock.scale.set(.8, 1.9, .72)
      lock.position.set(side * .23, 1.48, -.05)
      avatar.add(lock)
    }
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.027, 10, 8), clay(character.eyeColor || '#2C2C2A'))
    eye.position.set(side * .09, 1.57, .265)
    avatar.add(eye)
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(.055, .009, 7, 18, Math.PI), clay('#8c3155'))
  smile.rotation.z = Math.PI
  smile.position.set(0, 1.48, .277)
  avatar.add(smile)
  return avatar
}

function buildResidentMarker() {
  // A Poplur-pink plumbob makes the selected resident legible without
  // borrowing The Sims' protected green visual identity.
  const plumbob = new THREE.Mesh(new THREE.OctahedronGeometry(.16, 0), clay('#ff4fa7', .48))
  plumbob.position.y = 2.02
  plumbob.rotation.y = Math.PI / 4
  return plumbob
}

function buildGuestAvatar(guest: Pick<HouseGuest, 'id' | 'name'>) {
  // Remote character assets are not account-synced yet. Keep the guest honest:
  // this is a lightweight in-room presence marker for the real voice peer,
  // while the resident remains the exact character created in Wardrobe.
  const avatar = new THREE.Group()
  const accent = guestPalette(guest.id)
  const skin = '#d9a079'
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(.3, 24),
    new THREE.MeshBasicMaterial({ color: '#251747', transparent: true, opacity: .23, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = .01
  avatar.add(shadow)
  for (const side of [-1, 1]) {
    addCylinder(avatar, .1, .45, [side * .13, .29, 0], '#45305f', 12)
    addCylinder(avatar, .075, .48, [side * .36, .87, 0], skin, 12).rotation.z = side * -.1
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.29, .4, 5, 12), clay(accent))
  torso.position.y = .88
  avatar.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 18, 12), clay(skin))
  head.position.y = 1.48
  avatar.add(head)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.282, 18, 12), clay('#392b3a'))
  hair.scale.y = .64
  hair.position.set(0, 1.64, -.02)
  avatar.add(hair)
  const voice = new THREE.Mesh(
    new THREE.TorusGeometry(.19, .035, 10, 26),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .55, roughness: .5 }),
  )
  voice.rotation.x = Math.PI / 2
  voice.position.y = 1.97
  voice.userData.houseVoicePeer = guest.name
  avatar.add(voice)
  avatar.position.set(1.55, .06, .55)
  avatar.rotation.y = -.58
  return avatar
}

function normalizeResidentModel(model: THREE.Object3D) {
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.y) || size.y < .01) throw new Error('Avatar export has no usable height')
  model.scale.setScalar(1.72 / size.y)
  model.updateMatrixWorld(true)
  const scaled = new THREE.Box3().setFromObject(model)
  const center = scaled.getCenter(new THREE.Vector3())
  model.position.set(-center.x, -scaled.min.y, -center.z)
  model.updateMatrixWorld(true)
}

function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    geometries.add(child.geometry)
    const meshMaterials = Array.isArray(child.material) ? child.material : [child.material]
    meshMaterials.forEach(material => {
      materials.add(material)
      Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture) textures.add(value)
      })
    })
  })
  textures.forEach(texture => texture.dispose())
  materials.forEach(material => material.dispose())
  geometries.forEach(geometry => geometry.dispose())
}

export default function HouseScreen() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<HouseRuntime | null>(null)
  const characterRuntimeRef = useRef<PoplurAvatarHandle | null>(null)
  const callRef = useRef<CallSnapshot | null>(callState())
  const [life, setLife] = useState<HouseLifeState>(() => readHouseLife())
  const lifeRef = useRef(life)
  lifeRef.current = life
  const [status, setStatus] = useState('Tap the floor to walk around')
  const [character, setCharacter] = useState(() => studioInitialCharacter(readCharacter()))
  const characterRef = useRef(character)
  characterRef.current = character
  const [wardrobeProvider] = useState(readWardrobeProvider)
  const [residentSource, setResidentSource] = useState<'loading' | 'avaturn' | 'classic'>('loading')
  const [remoteFashion, setRemoteFashion] = useState<RemoteWardrobeStyles>({ top: [], bottom: [] })
  const remoteFashionRef = useRef(remoteFashion)
  remoteFashionRef.current = remoteFashion
  const [reach, setReach] = useState(() => radiusKm())
  const [guests, setGuests] = useState<HouseGuest[]>([])
  const [guestsLoading, setGuestsLoading] = useState(true)
  const [guestRefresh, setGuestRefresh] = useState(0)
  const [partyOpen, setPartyOpen] = useState(false)
  const [invitedGuest, setInvitedGuest] = useState<HouseGuest | null>(null)
  const [call, setCall] = useState<CallSnapshot | null>(() => callState())
  const location = useNearbyLocation()
  const [rendererId] = useState(() => `HouseScreen:${++houseRendererSequence}`)

  const commit = useCallback((next: HouseLifeState) => {
    saveHouseLife(next)
    setLife(next)
  }, [])

  const doActivity = useCallback((id: HouseActivityId) => {
    playPop()
    const next = performHouseActivity(life, id)
    commit(next)
    const activity = HOUSE_ACTIVITIES.find(item => item.id === id)!
    const target = toMansionPosition(activity.target.x, activity.target.z)
    setStatus(activity.status)
    runtimeRef.current?.moveTo(target.x, target.z, id)
  }, [commit, life])

  const nudgeResident = useCallback((dx: number, dz: number) => {
    playPop(.16)
    const current = lifeRef.current
    const next = moveHouseAvatar(current, current.x + dx, current.z + dz)
    const destination = toMansionPosition(next.x, next.z)
    commit(next)
    setStatus('Walking through the mansion')
    runtimeRef.current?.moveTo(destination.x, destination.z)
  }, [commit])

  useEffect(() => onCharacterChange(() => {
    setCharacter(studioInitialCharacter(readCharacter()))
  }), [])

  useEffect(() => {
    const controller = new AbortController()
    void loadWardrobeCatalog(controller.signal).then(next => {
      if (!controller.signal.aborted) setRemoteFashion(next)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    characterRuntimeRef.current?.update(character, remoteFashion)
  }, [character, remoteFashion])

  useEffect(() => {
    const sync = () => setReach(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  useEffect(() => subscribeCall(next => {
    const previous = callRef.current
    callRef.current = next
    setCall(next)
    if (next.context !== 'house') return
    if (next.phase === 'connected') setStatus(`${next.peerName} joined your House`)
    else if (next.phase === 'ended') {
      setStatus(previous?.phase === 'connected' ? 'Your guest left the House' : 'House invite ended')
    }
  }), [])

  useEffect(() => {
    const liveGuest = call?.context === 'house' && call.phase === 'connected'
      ? { id: invitedGuest?.id ?? call.callId ?? call.peerName, name: call.peerName }
      : null
    runtimeRef.current?.setGuest(liveGuest)
  }, [call?.callId, call?.peerName, call?.phase, invitedGuest?.id])

  useEffect(() => {
    let cancelled = false
    let bridgeAnswered = false
    const currentUid = accountSnapshot().uid
    setGuestsLoading(true)

    // A catalogue fallback is useful for browsing media, but it is not the
    // person's position. House invitations must wait for an actual device fix
    // or they could mislabel Toronto accounts as being in the user's radius.
    if (!location) return () => { cancelled = true }
    if (location.source !== 'device') {
      setGuests([])
      setGuestsLoading(false)
      return () => { cancelled = true }
    }

    const requestId = `house-guests:${Date.now()}:${++houseGuestRequestSequence}`

    const accept = (data: unknown) => {
      if (!data || typeof data !== 'object') return
      const payload = data as { type?: unknown, contacts?: unknown, requestId?: unknown }
      if (payload.type !== 'poplurPhoneContacts'
        || payload.requestId !== requestId
        || !Array.isArray(payload.contacts)) return
      // Home returns an empty acknowledgement in a plain browser. That is not
      // a real nearby result, so let the authenticated web query/preview take
      // over instead of treating it as an authoritative empty radius.
      if (!isNativeShell() && payload.contacts.length === 0) return
      bridgeAnswered = true
      if (!cancelled) {
        setGuests(normalizeHouseGuests(payload.contacts, currentUid, reach))
        setGuestsLoading(false)
      }
    }
    const onResult = (event: Event) => accept((event as CustomEvent).detail)
    window.addEventListener('poplur-dm-result', onResult)

    // Use Home's existing validated native relay. It supplies the current
    // radius/location again at the shell boundary and never publishes either
    // coordinate in House or in the invitation UI.
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: {
        type: 'requestPhoneContacts',
        requestId,
        radiusKm: reach,
        latitude: location.lat,
        longitude: location.lng,
      },
    }))

    const fallback = window.setTimeout(() => {
      if (bridgeAnswered || cancelled) return
      void (async () => {
        let real: HouseGuest[] = []
        if (location) {
          try {
            const { fetchWebHouseGuests } = await import('./webHouseGuests')
            real = await fetchWebHouseGuests(location, reach)
          } catch { /* signed-out/offline browser falls through to preview */ }
        }
        if (cancelled || bridgeAnswered) return
        setGuests(real.length ? real : previewHouseGuests(reach, 6))
        setGuestsLoading(false)
      })()
    }, 650)

    return () => {
      cancelled = true
      window.clearTimeout(fallback)
      window.removeEventListener('poplur-dm-result', onResult)
    }
  }, [guestRefresh, location, reach])

  const inviteGuest = useCallback((guest: HouseGuest) => {
    playPop()
    if (guest.preview) {
      setStatus('Sign in on Poplur to send this House invite and use the mic')
      return
    }
    if (call && call.phase !== 'idle' && call.phase !== 'ended') {
      setStatus(`Finish your current call before inviting ${guest.name}`)
      return
    }
    setInvitedGuest(guest)
    setPartyOpen(false)
    setStatus(`Inviting ${guest.name} to your House…`)
    void placeCall(guest.id, guest.name, `${houseHostName()}'s House`, {
      video: false,
      context: 'house',
    })
  }, [call])

  const leaveVoice = useCallback(() => {
    playPop()
    hangup()
    setInvitedGuest(null)
    setStatus('House voice ended')
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let rendererActive = false
    let motionFrame = 0
    let residentMotion: PoplurAvatarMotion = 'idle'
    let residentMotionProgress = 0
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#522343')
    // Keep only a faint far-edge haze. The mansion camera sits roughly
    // 25 units away, so the old 18-unit fog start washed the whole estate into
    // one pink silhouette and made both its rooms and resident hard to read.
    scene.fog = new THREE.Fog('#522343', 28, 44)
    const camera = new THREE.OrthographicCamera(-7.5, 7.5, 8, -8, .1, 60)
    camera.position.set(13.2, 15.4, 14.2)
    camera.lookAt(0, .25, .1)
    // governor-ok: House registers this context immediately below. Its one
    // low-rate resident idle subscriber uses the shared frame governor.
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }) // governor-ok: registered immediately below; shared-clock motion only.
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = .76
    renderer.shadowMap.enabled = false
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5, PoplurPerformanceManager.policy.maximumPixelRatio))
    host.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffeef7, 0x47233d, 1.65))
    const key = new THREE.DirectionalLight(0xffd4e8, 1.45)
    key.position.set(4, 9, 6)
    scene.add(key)
    // A neutral one-time IBL pass gives saved Avaturn materials their intended
    // skin/fabric response without introducing another scene, canvas or loop.
    const environmentScene = new RoomEnvironment()
    const environmentGenerator = new THREE.PMREMGenerator(renderer)
    const environmentTarget = environmentGenerator.fromScene(environmentScene, .04)
    scene.environment = environmentTarget.texture
    environmentScene.dispose()
    environmentGenerator.dispose()
    const room = buildRoom(scene)
    const avatar = new THREE.Group()
    avatar.scale.setScalar(1.18)
    const localResident = buildAvatar(characterRef.current)
    localResident.scale.setScalar(.92 * (characterRef.current.heightScale ?? .96))
    avatar.add(localResident, buildResidentMarker())
    const residentStart = toMansionPosition(life.x, life.z)
    avatar.position.set(residentStart.x, .06, residentStart.z)
    scene.add(avatar)
    let guestAvatar: THREE.Group | null = null

    const render = () => {
      if (!disposed && rendererActive) renderer.render(scene, camera)
    }
    const resize = () => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const viewWidth = 14.25
      const viewHeight = viewWidth / (rect.width / rect.height)
      camera.left = -viewWidth / 2
      camera.right = viewWidth / 2
      camera.top = viewHeight / 2
      camera.bottom = -viewHeight / 2
      camera.updateProjectionMatrix()
      renderer.setSize(rect.width, rect.height, false)
      render()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: rendererId,
      heavy: true,
      priority: 84,
      onActiveChange: (active, policy) => {
        rendererActive = active
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5, policy.maximumPixelRatio))
        if (active) resize()
      },
      releaseInactiveResources: () => renderer.clear(true, true, true),
    })

    let classicResident: PoplurAvatarHandle | null = null
    let fittedMotion: ExternalAvatarMotionHandle | null = null
    const applyResidentMotion = (motion: PoplurAvatarMotion, progress = 0) => {
      residentMotion = motion
      residentMotionProgress = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0
      host.dataset.residentMotion = motion
      classicResident?.applyMotion(motion, residentMotionProgress)
      fittedMotion?.applyMotion(motion, residentMotionProgress)
    }
    const ensureClassicResident = () => {
      if (classicResident || disposed) return
      setResidentSource('classic')
      host.dataset.residentRigJoints = '10'
      host.dataset.residentClips = ''
      classicResident = createPoplurAvatarRuntime({
        parent: avatar,
        character: characterRef.current,
        remoteFashion: remoteFashionRef.current,
        mode: '3d',
        targetHeight: 1.72,
        floorY: 0,
        requestRender: render,
        onStatus: next => {
          if (next.includes('could not load')) setStatus(next)
        },
        onModelLoaded: part => {
          if (part === 'body' && !fittedResident) {
            localResident.visible = false
            classicResident?.applyMotion(residentMotion, residentMotionProgress)
          }
          render()
        },
      })
      characterRuntimeRef.current = classicResident
    }

    let avatarRevision = 0
    let fittedResident: THREE.Object3D | null = null
    const removeFittedResident = () => {
      fittedMotion?.dispose()
      fittedMotion = null
      if (!fittedResident) return
      avatar.remove(fittedResident)
      disposeObject(fittedResident)
      fittedResident = null
    }
    const useClassicResident = () => {
      removeFittedResident()
      localResident.visible = true
      setResidentSource('classic')
      ensureClassicResident()
      classicResident?.update(characterRef.current, remoteFashionRef.current)
    }
    const avatarLoader = new GLTFLoader()
    const loadSavedResident = async () => {
      const revision = ++avatarRevision
      const saved = readSavedAvaturnAvatar()
      if (wardrobeProvider === 'poplur' || !saved) {
        useClassicResident()
        return
      }
      setResidentSource('loading')
      let resolved: Awaited<ReturnType<typeof resolveSavedAvaturnAvatarUrl>> = null
      try {
        resolved = await resolveSavedAvaturnAvatarUrl(saved)
        if (!resolved || disposed || revision !== avatarRevision) {
          if (resolved?.revoke) URL.revokeObjectURL(resolved.url)
          if (!disposed && revision === avatarRevision) {
            if (!fittedResident) useClassicResident()
            else setResidentSource('avaturn')
          }
          return
        }
        avatarLoader.load(resolved.url, gltf => {
          if (resolved?.revoke) URL.revokeObjectURL(resolved.url)
          if (disposed || revision !== avatarRevision) {
            disposeObject(gltf.scene)
            return
          }
          try {
            normalizeResidentModel(gltf.scene)
            classicResident?.dispose()
            classicResident = null
            characterRuntimeRef.current = null
            removeFittedResident()
            fittedResident = gltf.scene
            fittedMotion = createExternalAvatarMotion(fittedResident, gltf.animations, render)
            host.dataset.residentRigJoints = String(fittedMotion.rigJointCount)
            host.dataset.residentClips = fittedMotion.clipNames.join(',')
            localResident.visible = false
            avatar.add(fittedResident)
            setResidentSource('avaturn')
            applyResidentMotion(residentMotion, residentMotionProgress)
          } catch {
            disposeObject(gltf.scene)
            if (!fittedResident) useClassicResident()
            else setResidentSource('avaturn')
            render()
          }
        }, undefined, () => {
          if (resolved?.revoke) URL.revokeObjectURL(resolved.url)
          if (!disposed && revision === avatarRevision) {
            if (!fittedResident) useClassicResident()
            else setResidentSource('avaturn')
            render()
          }
        })
      } catch {
        if (resolved?.revoke) URL.revokeObjectURL(resolved.url)
        if (!disposed && revision === avatarRevision) {
          if (!fittedResident) useClassicResident()
          else setResidentSource('avaturn')
        }
      }
    }
    const onSavedAvatarChanged = () => { void loadSavedResident() }
    window.addEventListener('poplur-avaturn-avatar-changed', onSavedAvatarChanged)
    void loadSavedResident()

    const idleStartedAt = performance.now()
    const stopIdleFrames = onFrame((_dtMs, now) => {
      if (!rendererActive || residentMotion !== 'idle') return
      applyResidentMotion('idle', ((now - idleStartedAt) % 3_600) / 3_600)
    }, 'ambient')

    const moveTo = (x: number, z: number, activity: HouseActivityId | 'idle' = 'idle') => {
      if (motionFrame) {
        window.cancelAnimationFrame(motionFrame)
        motionFrame = 0
      }
      const startX = avatar.position.x
      const startZ = avatar.position.z
      const destinationX = THREE.MathUtils.clamp(x, -MANSION_WALK_BOUNDS.x, MANSION_WALK_BOUNDS.x)
      const destinationZ = THREE.MathUtils.clamp(z, -MANSION_WALK_BOUNDS.z, MANSION_WALK_BOUNDS.z)
      const dx = destinationX - startX
      const dz = destinationZ - startZ
      if (Math.abs(dx) + Math.abs(dz) > .01) avatar.rotation.y = Math.atan2(dx, dz)
      const startedAt = performance.now()
      const duration = Math.max(360, Math.min(920, Math.hypot(dx, dz) * 190))
      applyResidentMotion('walk', 0)
      const tick = (now: number) => {
        if (disposed) return
        const t = Math.min(1, (now - startedAt) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        avatar.position.x = THREE.MathUtils.lerp(startX, destinationX, eased)
        avatar.position.z = THREE.MathUtils.lerp(startZ, destinationZ, eased)
        avatar.position.y = .06 + Math.sin(t * Math.PI * 8) * .035 * (1 - t)
        applyResidentMotion('walk', t)
        if (t < 1) {
          // governor-ok: finite tap/activity walk tween, cancelled on unmount.
          motionFrame = window.requestAnimationFrame(tick)
          return
        }
        avatar.position.set(destinationX, .06, destinationZ)
        if (activity === 'dance') {
          const danceStarted = performance.now()
          const danceBaseRotation = avatar.rotation.y
          applyResidentMotion('dance', 0)
          const dance = (danceNow: number) => {
            if (disposed) return
            const danceT = Math.min(1, (danceNow - danceStarted) / 1450)
            avatar.rotation.y = danceBaseRotation + Math.sin(danceT * Math.PI * 4) * .72
            avatar.position.y = .06 + Math.abs(Math.sin(danceT * Math.PI * 6)) * .14
            applyResidentMotion('dance', danceT)
            if (danceT < 1) {
              // governor-ok: finite 1.45-second dance, never an idle loop.
              motionFrame = window.requestAnimationFrame(dance)
            } else {
              motionFrame = 0
              avatar.rotation.y = danceBaseRotation
              avatar.position.y = .06
              applyResidentMotion('idle', 0)
            }
          }
          // governor-ok: starts the finite dance sequence above.
          motionFrame = window.requestAnimationFrame(dance)
        } else {
          motionFrame = 0
          applyResidentMotion('idle', 0)
        }
      }
      // governor-ok: starts the finite walk sequence above.
      motionFrame = window.requestAnimationFrame(tick)
    }

    const setGuest = (guest: Pick<HouseGuest, 'id' | 'name'> | null) => {
      if (guestAvatar) {
        scene.remove(guestAvatar)
        disposeObject(guestAvatar)
        guestAvatar = null
      }
      if (guest) {
        guestAvatar = buildGuestAvatar(guest)
        scene.add(guestAvatar)
      }
      render()
    }

    runtimeRef.current = { moveTo, setGuest, render }
    const activeCall = callRef.current
    if (activeCall?.context === 'house' && activeCall.phase === 'connected') {
      setGuest({ id: activeCall.callId || activeCall.peerName, name: activeCall.peerName })
    }
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const intersection = new THREE.Vector3()
    let down: { x: number, y: number } | null = null
    const onPointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY } }
    const onPointerUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 12) { down = null; return }
      down = null
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      if (!raycaster.ray.intersectPlane(floorPlane, intersection)) return
      const next = moveHouseAvatar(
        {
          ...lifeRef.current,
          x: avatar.position.x / MANSION_SCALE.x,
          z: avatar.position.z / MANSION_SCALE.z,
        },
        intersection.x / MANSION_SCALE.x,
        intersection.z / MANSION_SCALE.z,
      )
      const destination = toMansionPosition(next.x, next.z)
      commit(next)
      setStatus('Walking through the mansion')
      moveTo(destination.x, destination.z)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    resize()

    return () => {
      disposed = true
      runtimeRef.current = null
      if (motionFrame) window.cancelAnimationFrame(motionFrame)
      stopIdleFrames()
      performanceRenderer.dispose()
      resizeObserver.disconnect()
      avatarRevision += 1
      window.removeEventListener('poplur-avaturn-avatar-changed', onSavedAvatarChanged)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      if (characterRuntimeRef.current === classicResident) characterRuntimeRef.current = null
      classicResident?.dispose()
      classicResident = null
      fittedMotion?.dispose()
      fittedMotion = null
      disposeObject(room)
      disposeObject(avatar)
      if (guestAvatar) {
        scene.remove(guestAvatar)
        disposeObject(guestAvatar)
        guestAvatar = null
      }
      renderer.domElement.remove()
      scene.environment = null
      environmentTarget.dispose()
      releaseWebGL(renderer)
    }
  }, [commit, rendererId, wardrobeProvider])

  return (
    <main
      className={styles.house}
      data-profile-house='isometric-mansion-v1'
      data-resident-source={residentSource}
    >
      <div ref={hostRef} className={styles.scene} aria-label='Interactive isometric 3D mansion; tap the floor or use the move pad to walk your avatar' />
      <header className={styles.titleCard}>
        <span>MY ESTATE · LIVE</span>
        <strong>Mansion</strong>
        <small>{residentSource === 'avaturn' ? 'Avaturn export' : residentSource === 'classic' ? 'Poplur Classic' : 'Loading avatar'} · {houseMood(life)} · {status}</small>
      </header>
      <button
        type='button'
        className={styles.partyButton}
        aria-expanded={partyOpen}
        aria-controls='house-party-panel'
        onClick={() => { playPop(); setPartyOpen(open => !open) }}
      >
        <b aria-hidden='true'>⌂+</b><span>Invite</span>
      </button>
      <section className={styles.needs} aria-label='Avatar needs'>
        <Need label='Energy' value={life.energy} color='#75d8ff' />
        <Need label='Hunger' value={life.hunger} color='#ffcf5d' />
        <Need label='Fun' value={life.fun} color='#ff65b2' />
      </section>
      {partyOpen && <section id='house-party-panel' className={styles.partyPanel} aria-label='Invite people in your radius'>
        <header>
          <div><span>HOUSE GUESTS</span><strong>People in your radius</strong></div>
          <button type='button' aria-label='Close House invitations' onClick={() => setPartyOpen(false)}>×</button>
        </header>
        <p>Invite one person at a time to join your House over mic. Your coordinates are never shown.</p>
        <div className={styles.partyActions}>
          <span>{reach.toFixed(reach >= 100 ? 0 : 1)} km radius</span>
          <button type='button' onClick={() => { playPop(); setGuestRefresh(value => value + 1) }}>Refresh</button>
        </div>
        <div className={styles.guestList} aria-live='polite'>
          {guestsLoading && <div className={styles.emptyGuests}>Looking inside your radius…</div>}
          {!guestsLoading && guests.length === 0 && <div className={styles.emptyGuests}>
            {location?.source === 'fallback'
              ? 'Turn on location to find people in your radius.'
              : 'Nobody is in your radius right now.'}
          </div>}
          {!guestsLoading && guests.map(guest => {
            const busy = Boolean(call && call.phase !== 'idle' && call.phase !== 'ended')
            return <article key={`${guest.preview ? 'preview' : 'live'}:${guest.id}`} className={styles.guestRow}>
              <span className={styles.guestAvatar} style={{ '--guest-color': guestPalette(guest.id) } as CSSProperties}>{guest.name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
              <div><strong>{guest.name}</strong><small>{guest.detail}</small></div>
              <button type='button' disabled={busy && invitedGuest?.id !== guest.id} onClick={() => inviteGuest(guest)}>
                {guest.preview ? 'Sign in' : invitedGuest?.id === guest.id && busy ? 'Invited' : 'Invite'}
              </button>
            </article>
          })}
        </div>
        {guests.some(guest => guest.preview) && <small className={styles.previewNote}>Preview people are examples. Sign in to discover and call real nearby accounts.</small>}
      </section>}
      {call?.context === 'house' && call.phase !== 'idle' && call.phase !== 'ended' && <section className={styles.voiceDock} aria-label='House voice room'>
        <span className={styles.liveDot} aria-hidden='true' />
        <div><strong>{call.peerName || invitedGuest?.name || 'House guest'}</strong><small>{houseCallLabel(call)}</small></div>
        <button type='button' disabled={call.phase !== 'connected'} aria-label={call.muted ? 'Unmute House microphone' : 'Mute House microphone'} aria-pressed={call.muted} onClick={() => { playPop(); toggleMute() }}>{call.muted ? 'Mic off' : 'Mic on'}</button>
        <button type='button' className={styles.leaveButton} onClick={leaveVoice}>Leave</button>
      </section>}
      <div className={styles.walkHint}>Tap the floor or use MOVE</div>
      <div className={styles.movePad} role='group' aria-label='Move around the mansion'>
        <span>MOVE</span>
        <button type='button' className={styles.moveUp} aria-label='Move up' onClick={() => nudgeResident(0, -0.7)}>▲</button>
        <button type='button' className={styles.moveLeft} aria-label='Move left' onClick={() => nudgeResident(-0.7, 0)}>◀</button>
        <button type='button' className={styles.moveRight} aria-label='Move right' onClick={() => nudgeResident(0.7, 0)}>▶</button>
        <button type='button' className={styles.moveDown} aria-label='Move down' onClick={() => nudgeResident(0, 0.7)}>▼</button>
      </div>
      <nav className={styles.activities} aria-label='House activities'>
        {HOUSE_ACTIVITIES.map(activity => (
          <button key={activity.id} type='button' onClick={() => doActivity(activity.id)} aria-pressed={life.activity === activity.id}>
            <b aria-hidden='true'>{activity.glyph}</b><span>{activity.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

function houseCallLabel(call: CallSnapshot) {
  if (call.phase === 'calling') return 'House invite ringing…'
  if (call.phase === 'connecting') return 'Joining House voice…'
  if (call.phase === 'connected') return call.muted ? 'Live · your mic is off' : 'Live together over mic'
  return 'House voice'
}

function Need({ label, value, color }: { label: string, value: number, color: string }) {
  return <div className={styles.need} style={{ '--need': `${value}%`, '--need-color': color } as CSSProperties}>
    <span>{label}</span><div><i /></div><b>{value}</b>
  </div>
}
