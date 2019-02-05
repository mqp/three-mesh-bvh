(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = global || self, factory(global.MeshBVHLib = global.MeshBVHLib || {}));
}(this, function (exports) { 'use strict';

	// From THREE.js Mesh raycast
	var vA = new THREE.Vector3();
	var vB = new THREE.Vector3();
	var vC = new THREE.Vector3();

	var uvA = new THREE.Vector2();
	var uvB = new THREE.Vector2();
	var uvC = new THREE.Vector2();

	var barycoord = new THREE.Vector3();
	var intersectionPoint = new THREE.Vector3();
	var intersectionPointWorld = new THREE.Vector3();

	function uvIntersection( point, p1, p2, p3, uv1, uv2, uv3 ) {

		THREE.Triangle.getBarycoord( point, p1, p2, p3, barycoord );

		uv1.multiplyScalar( barycoord.x );
		uv2.multiplyScalar( barycoord.y );
		uv3.multiplyScalar( barycoord.z );

		uv1.add( uv2 ).add( uv3 );

		return uv1.clone();

	}

	function checkIntersection( object, material, raycaster, ray, pA, pB, pC, point ) {

		var intersect;
		if ( material.side === THREE.BackSide ) {

			intersect = ray.intersectTriangle( pC, pB, pA, true, point );

		} else {

			intersect = ray.intersectTriangle( pA, pB, pC, material.side !== THREE.DoubleSide, point );

		}

		if ( intersect === null ) return null;

		intersectionPointWorld.copy( point );
		intersectionPointWorld.applyMatrix4( object.matrixWorld );

		var distance = raycaster.ray.origin.distanceTo( intersectionPointWorld );

		if ( distance < raycaster.near || distance > raycaster.far ) return null;

		return {
			distance: distance,
			point: intersectionPointWorld.clone(),
			object: object
		};

	}

	function checkBufferGeometryIntersection( object, raycaster, ray, position, uv, a, b, c ) {

		vA.fromBufferAttribute( position, a );
		vB.fromBufferAttribute( position, b );
		vC.fromBufferAttribute( position, c );

		var intersection = checkIntersection( object, object.material, raycaster, ray, vA, vB, vC, intersectionPoint );

		if ( intersection ) {

			if ( uv ) {

				uvA.fromBufferAttribute( uv, a );
				uvB.fromBufferAttribute( uv, b );
				uvC.fromBufferAttribute( uv, c );

				intersection.uv = uvIntersection( intersectionPoint, vA, vB, vC, uvA, uvB, uvC );

			}

			var normal = new THREE.Vector3();
			intersection.face = new THREE.Face3( a, b, c, THREE.Triangle.getNormal( vA, vB, vC, normal ) );
			intersection.faceIndex = a;

		}

		return intersection;

	}

	// For BVH code specifically. Does not check morph targets
	// Copied from mesh raycasting
	// Ripped an modified from the THREE.js source in Mesh.CS
	const intersectTri = ( mesh, geo, raycaster, ray, tri, intersections ) => {

		const triOffset = tri * 3;
		const a = geo.index.getX( triOffset );
		const b = geo.index.getX( triOffset + 1 );
		const c = geo.index.getX( triOffset + 2 );

		const intersection = checkBufferGeometryIntersection( mesh, raycaster, ray, geo.attributes.position, geo.attributes.uv, a, b, c );

		if ( intersection ) {

			intersection.faceIndex = tri;
			if ( intersections ) intersections.push( intersection );
			return intersection;

		}

		return null;

	};

	const intersectTris = ( mesh, geo, raycaster, ray, offset, count, intersections ) => {

		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			intersectTri( mesh, geo, raycaster, ray, i, intersections );

		}

	};

	const intersectClosestTri = ( mesh, geo, raycaster, ray, offset, count ) => {

		let dist = Infinity;
		let res = null;
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const intersection = intersectTri( mesh, geo, raycaster, ray, i );
			if ( intersection && intersection.distance < dist ) {

				res = intersection;
				dist = intersection.distance;

			}

		}

		return res;

	};

	// Returns a Float32Array representing the bounds data for box.
	function boundsToArray( bx ) {

		const arr = new Float32Array( 6 );

		arr[ 0 ] = bx.min.x;
		arr[ 1 ] = bx.min.y;
		arr[ 2 ] = bx.min.z;

		arr[ 3 ] = bx.max.x;
		arr[ 4 ] = bx.max.y;
		arr[ 5 ] = bx.max.z;

		return arr;

	}

	function arrayToBox( arr, target ) {

		target.min.x = arr[ 0 ];
		target.min.y = arr[ 1 ];
		target.min.z = arr[ 2 ];

		target.max.x = arr[ 3 ];
		target.max.y = arr[ 4 ];
		target.max.z = arr[ 5 ];

		return target;

	}

	function getLongestEdgeIndex( bounds ) {

		let splitDimIdx = - 1;
		let splitDist = - Infinity;

		for ( let i = 0; i < 3; i ++ ) {

			const dist = bounds[ i + 3 ] - bounds[ i ];
			if ( dist > splitDist ) {

				splitDist = dist;
				splitDimIdx = i;

			}

		}

		return splitDimIdx;

	}

	const boundingBox = new THREE.Box3();
	const boxIntersection = new THREE.Vector3();
	const xyzFields = [ 'x', 'y', 'z' ];

	class MeshBVHNode {

		constructor() {

			// internal nodes have boundingData, left, right, and splitAxis
			// leaf nodes have offset and count (referring to primitives in the mesh geometry)

		}

		intersectRay( ray, target ) {

			arrayToBox( this.boundingData, boundingBox );

			return ray.intersectBox( boundingBox, target );

		}

		raycast( mesh, raycaster, ray, intersects ) {

			if ( this.count ) intersectTris( mesh, mesh.geometry, raycaster, ray, this.offset, this.count, intersects );
			else {

				if ( this.left.intersectRay( ray, boxIntersection ) )
					this.left.raycast( mesh, raycaster, ray, intersects );
				if ( this.right.intersectRay( ray, boxIntersection ) )
					this.right.raycast( mesh, raycaster, ray, intersects );

			}

		}

		raycastFirst( mesh, raycaster, ray ) {

			if ( this.count ) {

				return intersectClosestTri( mesh, mesh.geometry, raycaster, ray, this.offset, this.count );

			} else {


				// consider the position of the split plane with respect to the oncoming ray; whichever direction
				// the ray is coming from, look for an intersection among that side of the tree first
				const splitAxis = this.splitAxis;
				const xyzAxis = xyzFields[ splitAxis ];
				const rayDir = ray.direction[ xyzAxis ];
				const leftToRight = rayDir >= 0;

				// c1 is the child to check first
				let c1, c2;
				if ( leftToRight ) {

					c1 = this.left;
					c2 = this.right;

				} else {

					c1 = this.right;
					c2 = this.left;

				}

				const c1Intersection = c1.intersectRay( ray, boxIntersection );
				const c1Result = c1Intersection ? c1.raycastFirst( mesh, raycaster, ray ) : null;

				// if we got an intersection in the first node and it's closer than the second node's bounding
				// box, we don't need to consider the second node because it couldn't possibly be a better result
				if ( c1Result ) {

					// check only along the split axis
					const rayOrig = ray.origin[ xyzAxis ];
					const toPoint = rayOrig - c1Result.point[ xyzAxis ];
					const toChild1 = rayOrig - c2.boundingData[ splitAxis ];
					const toChild2 = rayOrig - c2.boundingData[ splitAxis + 3 ];

					const toPointSq = toPoint * toPoint;
					if ( toPointSq <= toChild1 * toChild1 && toPointSq <= toChild2 * toChild2 ) {

						return c1Result;

					}

				}

				// either there was no intersection in the first node, or there could still be a closer
				// intersection in the second, so check the second node and then take the better of the two
				const c2Intersection = c2.intersectRay( ray, boxIntersection );
				const c2Result = c2Intersection ? c2.raycastFirst( mesh, raycaster, ray ) : null;

				if ( c1Result && c2Result ) {

					return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

				} else {

					return c1Result || c2Result || null;

				}

			}

		}

	}

	// Split strategy constants
	const CENTER = 0;
	const AVERAGE = 1;
	const SAH = 2;

	const xyzFields$1 = [ 'x', 'y', 'z' ];

	function getTriangleCount( geo ) {

		return geo.index ? ( geo.index.count / 3 ) : ( geo.attributes.position.count / 3 );

	}

	// TODO: This could probably be optimizied to not dig so deeply into an object
	// and reust some of the fetch values in some cases
	function getBufferGeometryVertexElem( geo, tri, vert, elem ) {

		return geo.attributes.position.array[ ( geo.index ? geo.index.array[ 3 * tri + vert ] : ( 3 * tri + vert ) ) * 3 + elem ];

	}

	// precomputes data about each triangle required for quickly calculating tree splits:
	//
	// - bounds: an array of size tris.length * 6 where triangle i maps to a
	//   [x_min, x_max, y_min, y_max, z_min, z_max] tuple starting at index i * 6,
	//   representing the minimum and maximum extent in each dimension of triangle i
	//
	// - centroids: an array of size tris.length * 3 where triangle i maps to an [x, y, z] triplet
	//   starting at index i * 3, representing the centroid of triangle i
	//
	function computeTriangleData( geo ) {

		const triCount = getTriangleCount( geo );
		const bounds = new Float32Array( triCount * 6 );
		const centroids = new Float32Array( triCount * 3 );

		for ( let tri = 0; tri < triCount; tri ++ ) {

			for ( let el = 0; el < 3; el ++ ) {

				const a = getBufferGeometryVertexElem( geo, tri, 0, el );
				const b = getBufferGeometryVertexElem( geo, tri, 1, el );
				const c = getBufferGeometryVertexElem( geo, tri, 2, el );
				bounds[ tri * 6 + el * 2 ] = Math.min( a, b, c );
				bounds[ tri * 6 + el * 2 + 1 ] = Math.max( a, b, c );
				centroids[ tri * 3 + el ] = ( a + b + c ) / 3;

			}

		}

		return { bounds, centroids };

	}

	const boxtemp = new THREE.Box3();

	class BVHConstructionContext {

		constructor( geo, options ) {

			this.geo = geo;
			this.options = options;

			const data = computeTriangleData( geo );
			this.centroids = data.centroids;
			this.bounds = data.bounds;

			// a list of every available triangle index
			const triCount = getTriangleCount( geo );
			this.tris = new Array( triCount );
			for ( let i = 0; i < triCount; i ++ ) this.tris[ i ] = i;

			// SAH Initialization
			this.sahplanes = null;
			if ( options.strategy === SAH ) {

				this.sahplanes = [ new Array( triCount ), new Array( triCount ), new Array( triCount ) ];
				for ( let tri = 0; tri < triCount; tri ++ ) {

					for ( let el = 0; el < 3; el ++ ) {

						this.sahplanes[ el ][ tri ] = { p: this.centroids[ tri * 3 + el ], tri };

					}

				}

			}

		}

		// returns the average coordinate on the specified axis of the all the provided triangles
		getAverage( offset, count, axis ) {

			let avg = 0;
			const centroids = this.centroids;
			const tris = this.tris;

			for ( let i = offset, end = offset + count; i < end; i ++ ) {

				avg += centroids[ tris[ i ] * 3 + axis ];

			}

			return avg / count;

		}

		// computes the union of the bounds of all of the given triangles and puts the resulting box in target
		getBounds( offset, count, target ) {

			let minx = Infinity;
			let miny = Infinity;
			let minz = Infinity;
			let maxx = - Infinity;
			let maxy = - Infinity;
			let maxz = - Infinity;
			const bounds = this.bounds;
			const tris = this.tris;

			for ( let i = offset, end = offset + count; i < end; i ++ ) {

				const tri = tris[ i ];

				minx = Math.min( minx, bounds[ tri * 6 + 0 ] );
				maxx = Math.max( maxx, bounds[ tri * 6 + 1 ] );
				miny = Math.min( miny, bounds[ tri * 6 + 2 ] );
				maxy = Math.max( maxy, bounds[ tri * 6 + 3 ] );
				minz = Math.min( minz, bounds[ tri * 6 + 4 ] );
				maxz = Math.max( maxz, bounds[ tri * 6 + 5 ] );

			}

			target[ 0 ] = minx;
			target[ 1 ] = miny;
			target[ 2 ] = minz;

			target[ 3 ] = maxx;
			target[ 4 ] = maxy;
			target[ 5 ] = maxz;

			return target;

		}

		// writes entries into a new geometry index (target) with the vertices of triangles from
		// offset through count
		writeReorderedIndices( offset, count, target ) {

			const tris = this.tris;
			const oldIndices = this.geo.index ? this.geo.index.array : null;

			for ( let i = offset, end = offset + count; i < end; i ++ ) {

				const oldTri = tris[ i ];
				target[ 3 * i + 0 ] = oldIndices ? oldIndices[ 3 * oldTri + 0 ] : 3 * oldTri + 0;
				target[ 3 * i + 1 ] = oldIndices ? oldIndices[ 3 * oldTri + 1 ] : 3 * oldTri + 1;
				target[ 3 * i + 2 ] = oldIndices ? oldIndices[ 3 * oldTri + 2 ] : 3 * oldTri + 1;

			}

		}

		// reorders `tris` such that for `count` elements after `offset`, elements on the left side of the split
		// will be on the left and elements on the right side of the split will be on the right. returns the index
		// of the first element on the right side, or offset + count if there are no elements on the right side.
		partition( offset, count, split ) {

			let left = offset;
			let right = offset + count - 1;
			const pos = split.pos;
			const axis = split.axis;
			const tris = this.tris;
			const centroids = this.centroids;

			// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
			while ( true ) {

				while ( left <= right && centroids[ tris[ left ] * 3 + axis ] < pos ) {

					left ++;

				}

				while ( left <= right && centroids[ tris[ right ] * 3 + axis ] >= pos ) {

					right --;

				}

				if ( left < right ) {

					let tmp = tris[ left ];
					tris[ left ] = tris[ right ];
					tris[ right ] = tmp;
					left ++;
					right --;

				} else {

					return left;

				}

			}

		}

		getOptimalSplit( bounds, offset, count, strategy ) {

			let axis = - 1;
			let pos = 0;

			// Center
			if ( strategy === CENTER ) {

				axis = getLongestEdgeIndex( bounds );
				if ( axis !== - 1 ) {

					pos = ( bounds[ axis + 3 ] + bounds[ axis ] ) / 2;

				}

			} else if ( strategy === AVERAGE ) {

				axis = getLongestEdgeIndex( bounds );
				if ( axis !== - 1 ) {

					pos = this.getAverage( offset, count, axis );

				}

			} else if ( strategy === SAH ) {

				// Surface Area Heuristic
				// In order to make this code more terse, the x, y, and z
				// variables of various structures have been stuffed into
				// 0, 1, and 2 array indices so they can be easily computed
				// and accessed within array iteration

				// Cost values defineed for operations. We're using bounds for traversal, so
				// the cost of traversing one more layer is more than intersecting a triangle.
				const TRAVERSAL_COST = 3;
				const INTERSECTION_COST = 1;
				const tris = this.tris;
				const bb = arrayToBox( bounds, boxtemp );

				// Define the width, height, and depth of the bounds as a box
				const dim = [
					bb.max.x - bb.min.x,
					bb.max.y - bb.min.y,
					bb.max.z - bb.min.z
				];
				const sa = 2 * ( dim[ 0 ] * dim[ 1 ] + dim[ 0 ] * dim[ 2 ] + dim[ 1 ] * dim[ 2 ] );

				// Get the precalculated planes based for the triangles we're
				// testing here
				const filteredLists = [[], [], []];
				for ( let i = offset, end = offset + count; i < end; i ++ ) {

					let t = tris[ i ];
					for ( let v = 0; v < 3; v ++ ) {

						filteredLists[ v ].push( this.sahplanes[ v ][ t ] );

					}

				}
				filteredLists.forEach( planes => planes.sort( ( a, b ) => a.p - b.p ) );

				// this bounds surface area, left bound SA, left triangles, right bound SA, right triangles
				const getCost = ( sa, sal, nl, sar, nr ) =>
					  TRAVERSAL_COST + INTERSECTION_COST * ( ( sal / sa ) * nl + ( sar / sa ) * nr );

				// the cost of _not_ splitting into smaller bounds
				const noSplitCost = INTERSECTION_COST * count;

				axis = - 1;
				let bestCost = noSplitCost;
				for ( let i = 0; i < 3; i ++ ) {

					// o1 and o2 represent the _other_ two axes in the
					// the space. So if we're checking the x (0) dimension,
					// then o1 and o2 would be y and z (1 and 2)
					const o1 = ( i + 1 ) % 3;
					const o2 = ( i + 2 ) % 3;

					const bmin = bb.min[ xyzFields$1[ i ] ];
					const bmax = bb.max[ xyzFields$1[ i ] ];
					const planes = filteredLists[ i ];

					// The number of left and right triangles on either side
					// given the current split
					let nl = 0;
					let nr = count;
					for ( let p = 0; p < planes.length; p ++ ) {

						const pinfo = planes[ p ];

						// As the plane moves, we have to increment or decrement the
						// number of triangles on either side of the plane
						nl ++;
						nr --;

						// the distance from the plane to the edge of the broader bounds
						const ldim = pinfo.p - bmin;
						const rdim = bmax - pinfo.p;

						// same for the other two dimensions
						let ldimo1 = dim[ o1 ], rdimo1 = dim[ o1 ];
						let ldimo2 = dim[ o2 ], rdimo2 = dim[ o2 ];

						/*
						// compute the other bounding planes for the box
						// if only the current triangles are considered to
						// be in the box
						// This is really slow and probably not really worth it
						const o1planes = this.sahplanes[o1];
						const o2planes = this.sahplanes[o2];
						let lmin = Infinity, lmax = -Infinity;
						let rmin = Infinity, rmax = -Infinity;
						planes.forEach((p, i) => {
						const tri2 = p.tri * 2;
						const inf1 = o1planes[tri2 + 0];
						const inf2 = o1planes[tri2 + 1];
						if (i <= nl) {
						lmin = Math.min(inf1.p, inf2.p, lmin);
						lmax = Math.max(inf1.p, inf2.p, lmax);
						}
						if (i >= nr) {
						rmin = Math.min(inf1.p, inf2.p, rmin);
						rmax = Math.max(inf1.p, inf2.p, rmax);
						}
						})
						ldimo1 = Math.min(lmax - lmin, ldimo1);
						rdimo1 = Math.min(rmax - rmin, rdimo1);

						planes.forEach((p, i) => {
						const tri2 = p.tri * 2;
						const inf1 = o2planes[tri2 + 0];
						const inf2 = o2planes[tri2 + 1];
						if (i <= nl) {
						lmin = Math.min(inf1.p, inf2.p, lmin);
						lmax = Math.max(inf1.p, inf2.p, lmax);
						}
						if (i >= nr) {
						rmin = Math.min(inf1.p, inf2.p, rmin);
						rmax = Math.max(inf1.p, inf2.p, rmax);
						}
						})
						ldimo2 = Math.min(lmax - lmin, ldimo2);
						rdimo2 = Math.min(rmax - rmin, rdimo2);
						*/

						// surface areas and cost
						const sal = 2 * ( ldimo1 * ldimo2 + ldimo1 * ldim + ldimo2 * ldim );
						const sar = 2 * ( rdimo1 * rdimo2 + rdimo1 * rdim + rdimo2 * rdim );
						const cost = getCost( sa, sal, nl, sar, nr );

						if ( cost < bestCost ) {

							axis = i;
							pos = pinfo.p;
							bestCost = cost;

						}

					}

				}

			}

			return { axis, pos };

		}

	}

	class MeshBVH extends MeshBVHNode {

		constructor( geo, options = {} ) {

			super();

			// default options
			options = Object.assign( {

				strategy: CENTER,
				maxDepth: 40,
				maxLeafTris: 10,
				verbose: true

			}, options );
			options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

			if ( geo.isBufferGeometry ) {

				this._root = this._buildTree( geo, options );

			} else {

				throw new Error( 'MeshBVH: Only BufferGeometries are supported.' );

			}

		}

		/* Private Functions */
		_buildTree( geo, options ) {

			const ctx = new BVHConstructionContext( geo, options );
			const verticesLength = geo.attributes.position.count;
			const indicesLength = ctx.tris.length * 3;
			const indices = new ( verticesLength < 65536 ? Uint16Array : Uint32Array )( indicesLength );
			let reachedMaxDepth = false;

			// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
			// recording the offset and count of its triangles and writing them into the reordered geometry index.
			const splitNode = ( node, offset, count, depth = 0 ) => {

				if ( depth >= options.maxDepth ) {

					reachedMaxDepth = true;

				}

				// early out if we've met our capacity
				if ( count <= options.maxLeafTris || depth >= options.maxDepth ) {

					ctx.writeReorderedIndices( offset, count, indices );
					node.offset = offset;
					node.count = count;
					return node;

				}

				// Find where to split the volume
				const split = ctx.getOptimalSplit( node.boundingData, offset, count, options.strategy );
				if ( split.axis === - 1 ) {

					ctx.writeReorderedIndices( offset, count, indices );
					node.offset = offset;
					node.count = count;
					return node;

				}

				const splitOffset = ctx.partition( offset, count, split );

				// create the two new child nodes
				if ( splitOffset === offset || splitOffset === offset + count ) {

					ctx.writeReorderedIndices( offset, count, indices );
					node.offset = offset;
					node.count = count;

				} else {

					node.splitAxis = split.axis;

					// create the left child and compute its bounding box
					const left = node.left = new MeshBVHNode();
					const lstart = offset, lcount = splitOffset - offset;
					left.boundingData = ctx.getBounds( lstart, lcount, new Float32Array( 6 ) );
					splitNode( left, lstart, lcount, depth + 1 );

					// repeat for right
					const right = node.right = new MeshBVHNode();
					const rstart = splitOffset, rcount = count - lcount;
					right.boundingData = ctx.getBounds( rstart, rcount, new Float32Array( 6 ) );
					splitNode( right, rstart, rcount, depth + 1 );

				}

				return node;

			};

			if ( ! geo.boundingBox ) geo.computeBoundingBox();
			this.boundingData = boundsToArray( geo.boundingBox );
			this.index = new THREE.BufferAttribute( indices, 1 );
			splitNode( this, 0, ctx.tris.length );

			if ( reachedMaxDepth && options.verbose ) {

				console.warn( `MeshBVH: Max depth of ${ options.maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
				console.warn( this, geo );

			}

			return this;

		}

	}

	const wiremat = new THREE.LineBasicMaterial( { color: 0x00FF88, transparent: true, opacity: 0.3 } );
	const boxGeom = new THREE.Box3Helper().geometry;
	let boundingBox$1 = new THREE.Box3();

	class MeshBVHVisualizer extends THREE.Object3D {

		constructor( mesh, depth = 10 ) {

			super();

			this.depth = depth;
			this._oldDepth = - 1;
			this._mesh = mesh;
			this._boundsTree = null;

			this.update();

		}

		update() {

			if ( this._mesh.geometry.boundsTree !== this._boundsTree || this._oldDepth !== this.depth ) {

				this._oldDepth = this.depth;
				this._boundsTree = this._mesh.geometry.boundsTree;

				let requiredChildren = 0;
				if ( this._boundsTree ) {

					const recurse = ( n, d ) => {

						let isLeaf = 'count' in n;

						if ( d === this.depth ) return;

						if ( d === this.depth - 1 || isLeaf ) {

							let m = requiredChildren < this.children.length ? this.children[ requiredChildren ] : null;
							if ( ! m ) {

								m = new THREE.LineSegments( boxGeom, wiremat );
								m.raycast = () => [];
								this.add( m );

							}
							requiredChildren ++;
							arrayToBox( n.boundingData, boundingBox$1 );
							boundingBox$1.getCenter( m.position );
							m.scale.subVectors( boundingBox$1.max, boundingBox$1.min ).multiplyScalar( 0.5 );

						}

						if ( ! isLeaf ) {

							recurse( n.left, d + 1 );
							recurse( n.right, d + 1 );

						}

					};

					recurse( this._boundsTree._root, 0 );

				}

				while ( this.children.length > requiredChildren ) this.remove( this.children.pop() );

			}

			this.position.copy( this._mesh.position );
			this.rotation.copy( this._mesh.rotation );
			this.scale.copy( this._mesh.scale );

		}

	}

	const ray = new THREE.Ray();
	const tmpInverseMatrix = new THREE.Matrix4();
	const origMeshRaycastFunc = THREE.Mesh.prototype.raycast;

	function acceleratedRaycast( raycaster, intersects ) {

		if ( this.geometry.boundsTree ) {

			if ( this.material === undefined ) return;

			tmpInverseMatrix.getInverse( this.matrixWorld );
			ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

			if ( raycaster.firstHitOnly === true ) {

				const res = this.geometry.boundsTree.raycastFirst( this, raycaster, ray );
				if ( res ) intersects.push( res );

			} else {

				this.geometry.boundsTree.raycast( this, raycaster, ray, intersects );

			}

		} else {

			origMeshRaycastFunc.call( this, raycaster, intersects );

		}

	}

	function computeBoundsTree( options ) {

		this.boundsTree = new MeshBVH( this, options );
		this.setIndex( this.boundsTree.index );
		return this.boundsTree;

	}

	function disposeBoundsTree() {

		this.boundsTree = null;

	}

	exports.MeshBVH = MeshBVH;
	exports.Visualizer = MeshBVHVisualizer;
	exports.acceleratedRaycast = acceleratedRaycast;
	exports.computeBoundsTree = computeBoundsTree;
	exports.disposeBoundsTree = disposeBoundsTree;
	exports.CENTER = CENTER;
	exports.AVERAGE = AVERAGE;
	exports.SAH = SAH;

	Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=index.js.map
