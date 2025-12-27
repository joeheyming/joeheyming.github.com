#include "PriorityQueue.h"

// remove front element
SearchNode* PriorityQueue::pop(){

	// get the node at the front
	SearchNode * node = heap.front();

	// move node from fron to position N
	// sort heap to make positions 1 through N-1 correct
	pop_heap(heap.begin(), heap.end(), Compare());

	// remove last node (the one we placed here earlier)
	heap.pop_back();

	return node;
}

// push element onto stack
void PriorityQueue::push(SearchNode* node){
	// push node onto vector
	heap.push_back(node);

	// sort the new vector
	push_heap(heap.begin(), heap.end(), Compare());
}

// takes in a SearchNode with a changed heuristic value 
// resorts the heap to keep it sorted with new value
void PriorityQueue::update(SearchNode* node){
	vector<SearchNode*>::iterator i;
	// find node to be updated
	for(i = heap.begin(); i != heap.end(); i++){
		if((*i)->terrain == node->terrain){
			//found node, resort from this position
			push_heap(heap.begin(), i+1, Compare());
			return;
		}
	}
}

