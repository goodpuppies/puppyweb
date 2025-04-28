import React, { useRef, useState, useEffect, RefObject, ReactNode } from 'react';
import { useFrame, Canvas, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  Group,
  Quaternion,
  Scene as SceneImpl,
} from 'three'
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin, VRM, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';

import { create } from 'zustand';


const useSceneStore = create(() => ({
  boneTransformations: {} as Record<string, ReturnType<typeof createDefaultTransformation>>,
}))

function createDefaultTransformation() {
  return {
    rotation: new Quaternion().toArray(),
  }
}
function BoneGizmo({
  boneRef,
  children
}: {
  boneRef: RefObject<THREE.Object3D | null>,
  children: ReactNode
}) {
  const groupRef = useRef<Group>(null);
  useFrame(() => {
    if (boneRef.current && groupRef.current) {
      const worldPos = new THREE.Vector3();
      boneRef.current.getWorldPosition(worldPos);
      groupRef.current.position.copy(worldPos);
    }
  });
  return <group ref={groupRef}>{children}</group>
}


export const Scene = () => {
  const cubeRef = useRef<THREE.Mesh>(null);

  /* useFrame(() => {
    if (cubeRef.current) {
      cubeRef.current.rotation.y += 0.05;
      cubeRef.current.rotation.x += 0.05;
    }
  }); */

  function VRMModelHandles({ }) {
    const gltf = useLoader(GLTFLoader, "/public/Velle.vrm", (loader) => {
      loader.register((parser: any) => new VRMLoaderPlugin(parser));
    });

    const vrm = useRef<VRM>(null);
    const clock = useRef(new THREE.Clock());
    const [bonesReady, setBonesReady] = useState(false);

    const bones = [
      { key: VRMHumanBoneName.LeftUpperArm, ref: useRef<THREE.Object3D>(null) },
      { key: VRMHumanBoneName.LeftLowerArm, ref: useRef<THREE.Object3D>(null) },
      { key: VRMHumanBoneName.RightUpperArm, ref: useRef<THREE.Object3D>(null) },
      { key: VRMHumanBoneName.RightLowerArm, ref: useRef<THREE.Object3D>(null) },
      { key: VRMHumanBoneName.LeftHand, ref: useRef<THREE.Object3D>(null) },
      { key: VRMHumanBoneName.RightHand, ref: useRef<THREE.Object3D>(null) },


    ];

    useEffect(() => {
      if (gltf && gltf.userData.vrm) {
        vrm.current = gltf.userData.vrm;
        if (!vrm.current) throw new Error("VRM not loaded correctly");

        VRMUtils.removeUnnecessaryVertices(vrm.current.scene);
        VRMUtils.combineSkeletons(vrm.current.scene);
        VRMUtils.combineMorphs(vrm.current);
        vrm.current.scene.position.z = 0;
        vrm.current.scene.rotation.y = Math.PI;
        vrm.current.scene.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh) {
            const mesh = obj;
            mesh.material = new THREE.MeshBasicMaterial({
              map: (mesh.material as THREE.MeshStandardMaterial).map,
              color: new THREE.Color("#c4c4c4"),
              side: THREE.DoubleSide,
            });
          }
        });
        vrm.current.scene.traverse((obj: THREE.Object3D) => {
          obj.frustumCulled = false;
        });

        // Automatically assign the bone refs using only the VRMHumanBoneName key.
        bones.forEach((bone) => {
          const boneNode = vrm.current!.humanoid.getNormalizedBoneNode(bone.key);
          bone.ref.current = boneNode;
          // Initialize the bone transformation if it hasn't been initialized yet.
          if (boneNode && !useSceneStore.getState().boneTransformations[boneNode.uuid]) {
            useSceneStore.setState((state) => ({
              boneTransformations: {
                ...state.boneTransformations,
                [boneNode.uuid]: createDefaultTransformation(),
              }
            }));
          }
        });

        setBonesReady(true);
      }
    }, [gltf, bones]);

    useFrame(() => {
      if (vrm.current) {
        vrm.current.update(clock.current.getDelta());
      }
    });

    return (
      <>
        <primitive object={gltf.scene} />

      </>
    );
  }

  return (
    <>
      {/* <gridHelper args={[10, 10]} visible /> */}
      <ambientLight intensity={0.5} />
      <pointLight intensity={0.3} position={[0, 2, -1]} />
      <group position={[0.07, 0.27, -2.06]} scale={[0.59, 0.59, 0.59]}>
        <VRMModelHandles />
      </group>

      <mesh ref={cubeRef} position={[0.06, 1.03, -2.07]} scale={[0.21, 0.21, 0.21]}> {/* Adjusted position/scale */}
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={0x00ffff} roughness={0.5} metalness={0.1} /> {/* Changed material */}
      </mesh>
    </>
  );
};
