import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export const Scene = () => {
  const cubeRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (cubeRef.current) {
      cubeRef.current.rotation.y += 0.05;
      cubeRef.current.rotation.x += 0.05;
    }
  });

  return (
    <>
      <gridHelper args={[10, 10]} />
      <ambientLight intensity={0.5} />
      <mesh ref={cubeRef} position={[0, -0.32, -2]} scale={0.5}> {/* Adjusted position/scale */}
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={0x00ffff} roughness={0.5} metalness={0.1} /> {/* Changed material */}
      </mesh>
    </>
  );
};
