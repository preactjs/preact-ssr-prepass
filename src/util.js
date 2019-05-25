/**
 * Copy all properties from `props` onto `obj`.
 * @param {object} obj Object onto which properties should be copied.
 * @param {object} props Object from which to copy properties.
 * @returns {object}
 * @private
 */
export function assign(obj, props) {
	for (let i in props) obj[i] = props[i];
	return obj;
}

/**
 * Get flattened children from the children prop
 * @param {Array} accumulator
 * @param {any} children A `props.children` opaque object.
 * @returns {Array} accumulator
 * @private
 */
export function getChildren(accumulator, children) {
	if (Array.isArray(children)) {
		children.reduce(getChildren, accumulator);
	}
	else if (children!=null && children!==false) {
		accumulator.push(children);
	}
	return accumulator;
}
