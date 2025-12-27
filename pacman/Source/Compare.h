#ifndef COMPARE_H
#define COMPARE_H

using namespace std;

class Compare{
public:
	bool operator()(SearchNode * first, SearchNode * second) const{
		return ( first->total > second->total);
	}
};

#endif
