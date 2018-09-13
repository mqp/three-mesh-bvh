
postMessage("alive");
importScripts('../node_modules/three/build/three.min.js', './gltfLoader.js');

onmessage = function ( e ) {

	const loader = new GLTFLoader();
	loader.load( e.data.url, root => {

		postMessage( { scene: root.scene } );

	} );

};
